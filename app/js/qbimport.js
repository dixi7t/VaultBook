/* VaultBook — QuickBooks migration engine (pure logic; no DOM, runs in Node and the browser).
 *
 * Reads the files QuickBooks Desktop exports for a company and turns them into one import "plan":
 *   IIF lists ......... Chart of Accounts (!ACCNT), Customers (!CUST), Vendors (!VEND), Other Names (!OTHERNAME),
 *                       Terms (!TERMS), Items (!INVITEM), Classes (!CLASS), and IIF transactions (!TRNS/!SPL)
 *   CSV reports ....... General Ledger / Journal / Transaction Detail by Account (Debit/Credit or Amount columns;
 *                       "Trans #" used when present, otherwise transactions are rebuilt from the ledger lines)
 *   Address list TXT .. tab-separated contact address export (fills missing addresses)
 *   PDF reports ....... Profit & Loss / Balance Sheet — used only to verify totals after import (see verifyText)
 * and the reports QuickBooks Online exports to Excel or CSV (a file is then { name, rows } — a sheet as rows of cells):
 *   Journal ........... every transaction exactly as posted (preferred); the General Ledger is rebuilt when there is no Journal
 *   Balance Sheet + Profit and Loss, or Account List ... what type each account is, and its sub-accounts
 *   Trial Balance ..... the balance every account must end with (checked after import)
 *   Customer / Vendor / Employee Contact List ... names, phone, email, address
 *
 * The plan is then turned into a VaultBook bundle (accounts, contacts, items, classes, transactions) that
 * Book.importBundle() posts in one atomic write. Every transaction still goes through the normal posting
 * rules (normalize/validate/buildSplits); nothing here writes splits directly.
 *
 * Amounts are integer cents. A posting amount > 0 is a debit, < 0 a credit (VaultBook convention).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema;
  var Q = OB.qbimport = {};

  /* ===================== low-level parsing ===================== */
  function cents(v) {
    if (v === undefined || v === null) return 0;
    var s = String(v).trim(); if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || /-$/.test(s);
    s = s.replace(/[()$,\s%]/g, '').replace(/-$/, '');
    if (s === '' || s === '-') return 0;
    var n = Math.round(parseFloat(s) * 100);
    if (!isFinite(n)) return 0;
    return neg ? -Math.abs(n) : n;
  }
  Q.cents = cents;
  /** QuickBooks dates: MM/DD/YYYY, M/D/YY, YYYY-MM-DD. Returns 'YYYY-MM-DD' or ''. */
  function qbDate(v) {
    var s = String(v || '').trim(); var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
      var y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
      return y + '-' + pad(m[1]) + '-' + pad(m[2]);
    }
    return '';
  }
  function pad(x) { return String(x).length < 2 ? '0' + x : String(x); }
  Q.qbDate = qbDate;
  function unq(s) {
    s = s === undefined || s === null ? '' : String(s);
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1).replace(/""/g, '"');
    return s.replace(/\\n/g, '\n').trim();
  }
  /** RFC-4180 CSV parser (quoted fields, embedded commas/newlines). */
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i = 0, c;
    text = String(text).replace(/^﻿/, '');
    for (; i < text.length; i++) {
      c = text.charAt(i);
      if (q) { if (c === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
      if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text.charAt(i + 1) === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  Q.parseCSV = parseCSV;

  /** IIF: tab-separated sections. "!SEC col col" defines the columns for following "SEC ..." rows. */
  function parseIIF(text) {
    var out = { header: null, sections: {}, trns: [] }, cols = {}, cur = null;
    String(text).replace(/^﻿/, '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var cells = line.split('\t');
      var tag = cells[0].trim();
      if (tag.charAt(0) === '!') { cols[tag.slice(1)] = cells.slice(1).map(function (x) { return x.trim(); }); return; }
      var def = cols[tag]; if (!def) return;
      var rec = {}; def.forEach(function (k, i) { rec[k] = unq(cells[i + 1]); });
      if (tag === 'HDR') { out.header = rec; return; }
      if (tag === 'TRNS') { cur = { trns: rec, spl: [] }; out.trns.push(cur); return; }
      if (tag === 'SPL') { if (cur) cur.spl.push(rec); return; }
      if (tag === 'ENDTRNS') { cur = null; return; }
      (out.sections[tag] = out.sections[tag] || []).push(rec);
    });
    return out;
  }
  Q.parseIIF = parseIIF;

  /* ===================== file detection ===================== */
  /** Classify one file. kind: 'iif' | 'ledger-csv' | 'address-txt' | 'pdf' | 'unknown'. */
  Q.detect = function (name, text, isPdf, sheetRows) {
    var n = String(name || '');
    if (isPdf || /\.pdf$/i.test(n)) return { kind: 'pdf', name: n, label: 'Report (PDF) — used to check totals' };
    if (sheetRows) {   // a spreadsheet: a QuickBooks Online report, or a QuickBooks Desktop ledger saved as Excel
      var sq = qboSniff(sheetRows, n); if (sq) return sq;
      var sr = sheetRows.map(function (r) { return (r || []).map(cs); }), sh = (sr[0] || []).map(function (x) { return x.trim().toLowerCase(); });
      if (sh.indexOf('type') >= 0 && sh.indexOf('date') >= 0 && (sh.indexOf('debit') >= 0 || sh.indexOf('amount') >= 0)) return { kind: 'ledger-csv', name: n, rows: sr, label: (sh.indexOf('trans #') >= 0 ? 'Journal / transaction report' : 'General ledger') + ' (' + Math.max(0, sr.length - 1) + ' lines)' };
      return { kind: 'unknown', name: n, label: 'Not a recognised QuickBooks report' };
    }
    var t = String(text || '').replace(/^﻿/, '');
    if (/^\s*\{/.test(t) && /"format"\s*:\s*"vaultbook-qb-full"/.test(t.slice(0, 400))) {   // 1.32: the connector's Export everything
      try { var full = JSON.parse(t); return { kind: 'qbfull', name: n, full: full, label: 'QuickBooks Desktop connector — full export (' + ((full.company || {}).CompanyName || 'company') + ')' }; } catch (e) { return { kind: 'unknown', name: n, label: 'Damaged connector export: ' + e.message }; }
    }
    if (/^!(HDR|ACCNT|CUST|VEND|TRNS|OTHERNAME|TERMS|INVITEM|CLASS)/m.test(t)) {
      var iif = parseIIF(t), secs = Object.keys(iif.sections).filter(function (s) { return iif.sections[s].length && /^(ACCNT|CUST|VEND|OTHERNAME|TERMS|INVITEM|CLASS)$/.test(s); });
      var names = { ACCNT: 'Chart of accounts', CUST: 'Customers', VEND: 'Vendors', OTHERNAME: 'Other names', TERMS: 'Payment terms', INVITEM: 'Items', CLASS: 'Classes' };
      var parts = secs.map(function (s) { return names[s] + ' (' + iif.sections[s].length + ')'; });
      if (iif.trns.length) parts.push('Transactions (' + iif.trns.length + ')');
      var emptyList = !parts.length && /^!(OTHERNAME|CUST|VEND|ACCNT|TERMS|INVITEM|CLASS)/m.test(t);
      return { kind: 'iif', name: n, iif: iif, label: parts.length ? parts.join(', ') : emptyList ? 'Empty list (nothing to import)' : 'IIF file with no supported lists', empty: !parts.length };
    }
    var lines = t.split(/\r?\n/);
    if (/\t/.test(lines[0]) && /Address 1/i.test(lines[0]) && /Company Name/i.test(lines[0])) return { kind: 'address-txt', name: n, label: 'Address list (' + Math.max(0, lines.filter(function (l) { return l.trim(); }).length - 1) + ')' };
    var rows = parseCSV(t), h = (rows[0] || []).map(function (x) { return x.trim().toLowerCase(); });
    var q = qboSniff(rows, n); if (q) return q;   // a QuickBooks Online report saved as CSV
    if (h.indexOf('type') >= 0 && h.indexOf('date') >= 0 && (h.indexOf('debit') >= 0 || h.indexOf('amount') >= 0)) {
      var hasTn = h.indexOf('trans #') >= 0;
      return { kind: 'ledger-csv', name: n, rows: rows, label: (hasTn ? 'Journal / transaction report' : 'General ledger') + ' (' + Math.max(0, rows.length - 1) + ' lines)' };
    }
    return { kind: 'unknown', name: n, label: 'Not a recognised QuickBooks export' };
  };

  /* ===================== QuickBooks Online reports (rows of cells from Excel or CSV) ===================== */
  var QBO_TITLES = [[/^journal$/i, 'journal'], [/^(general ledger|transaction detail by account)$/i, 'gl'], [/^trial balance$/i, 'tb'], [/^balance sheet$/i, 'bs'],
    [/^(profit and loss|profit & loss|income statement)$/i, 'pnl'], [/^(account list|chart of accounts|account listing)$/i, 'accounts'],
    [/^customer contact list$/i, 'customers'], [/^vendor contact list$/i, 'vendors'], [/^employee contact list$/i, 'employees']];
  var QBO_NAMES = { journal: 'Journal', gl: 'General Ledger', tb: 'Trial Balance', bs: 'Balance Sheet', pnl: 'Profit and Loss', accounts: 'Account List', customers: 'Customer list', vendors: 'Vendor list', employees: 'Employee list' };
  var QBO_COLS = { date: ['date', 'transaction date'], type: ['transaction type', 'type'], num: ['num', 'no.', 'number', 'ref no.'], name: ['name', 'payee'], memo: ['memo/description', 'memo', 'description', 'line description'],
    account: ['account', 'account full name', 'full name', 'distribution account', 'account name'], debit: ['debit'], credit: ['credit'], amount: ['amount'], cls: ['class'] };
  // report section → QuickBooks account type
  var QBO_SECTION = { 'bank accounts': 'BANK', 'accounts receivable': 'AR', 'accounts receivable (a/r)': 'AR', 'other current assets': 'OCASSET', 'fixed assets': 'FIXASSET', 'other assets': 'OASSET',
    'accounts payable': 'AP', 'accounts payable (a/p)': 'AP', 'credit cards': 'CCARD', 'other current liabilities': 'OCLIAB', 'long-term liabilities': 'LTLIAB', 'long term liabilities': 'LTLIAB', 'equity': 'EQUITY',
    "shareholders' equity": 'EQUITY', "owner's equity": 'EQUITY', 'income': 'INC', 'cost of goods sold': 'COGS', 'expenses': 'EXP', 'other income': 'EXINC', 'other expenses': 'EXEXP', 'other expense': 'EXEXP' };
  var QBO_DEBIT = { BANK: 1, AR: 1, OCASSET: 1, FIXASSET: 1, OASSET: 1, COGS: 1, EXP: 1, EXEXP: 1 }, QBO_PL = { INC: 1, COGS: 1, EXP: 1, EXINC: 1, EXEXP: 1 };
  var QBO_TXN = { 'journal entry': 'General Journal', 'bill payment (check)': 'Bill Pmt -Check', 'bill payment (credit card)': 'Bill Pmt -CCard', 'bill payment': 'Bill Pmt -Check' };
  /** A cell as text: numbers and dates from a spreadsheet become plain strings; leading spaces (indentation) are kept. */
  function cs(v) {
    if (v === undefined || v === null) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    return String(v);
  }
  /** One worksheet (as SheetJS reads it) → rows of cells. QuickBooks Online writes every report amount as a formula
   *  ("=1234.56") and stores 0 as its value, so a constant formula is read as the number it spells. Date cells
   *  become YYYY-MM-DD (ssf = XLSX.SSF, optional). */
  Q.sheetRows = function (ws, ssf) {
    var rows = [];
    Object.keys(ws || {}).forEach(function (k) {
      var m = /^([A-Z]+)(\d+)$/.exec(k); if (!m) return;
      var c = 0, i, cell = ws[k], v; for (i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64;
      var fm = typeof cell.f === 'string' && /^=?\s*\(?(-?\d+(?:\.\d+)?)\)?\s*$/.exec(cell.f);
      if (fm) v = +fm[1];
      else if (cell.t === 'n' && ssf && cell.z && ssf.is_date(cell.z)) v = ssf.format('yyyy-mm-dd', cell.v);
      else if (cell.t === 'e' || cell.v === undefined || cell.v === null) return;
      else v = cell.v;
      var r = +m[2] - 1; (rows[r] = rows[r] || [])[c - 1] = v;
    });
    for (var r2 = 0; r2 < rows.length; r2++) { var row = rows[r2] = rows[r2] || []; for (var j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = ''; }
    return rows;
  };
  var filled = function (r) { return (r || []).map(cs).filter(function (x) { return x.trim(); }); };
  var allDates = function (p) { return /^all dates$/i.test(String(p || '').trim()); };
  function qboType(word) {
    var w = String(word || '').toLowerCase().replace(/\s*\(a\/[rp]\)/, '').trim();
    var list = [['other current asset', 'OCASSET'], ['other current liabilit', 'OCLIAB'], ['long term liabilit', 'LTLIAB'], ['long-term liabilit', 'LTLIAB'], ['accounts receivable', 'AR'], ['accounts payable', 'AP'], ['fixed asset', 'FIXASSET'],
      ['other asset', 'OASSET'], ['credit card', 'CCARD'], ['bank', 'BANK'], ['equity', 'EQUITY'], ['other income', 'EXINC'], ['other expense', 'EXEXP'], ['cost of goods sold', 'COGS'], ['income', 'INC'], ['expense', 'EXP']];
    for (var i = 0; i < list.length; i++) if (w.indexOf(list[i][0]) === 0) return list[i][1];
    return '';
  }
  function qboExtra(leaf, type) {
    return /^opening balance equity$/i.test(leaf) ? 'OPENBAL' : /^retained earnings$/i.test(leaf) ? 'RETEARNINGS' : type === 'OCASSET' && /^(undeposited funds|payments to deposit)$/i.test(leaf) ? 'UNDEPOSIT' : '';
  }
  /** Is this sheet a QuickBooks Online report? Its title stands alone on one of the first rows. */
  function qboSniff(rows, fname) {
    if (!rows || !rows.length) return null;
    var lim = Math.min(rows.length, 8), i, j, hit = null, c;
    for (i = 0; i < lim && !hit; i++) {
      c = filled(rows[i]); if (c.length !== 1) continue;
      for (j = 0; j < QBO_TITLES.length; j++) if (QBO_TITLES[j][0].test(c[0].trim())) { hit = { kind: 'qbo', name: fname, report: QBO_TITLES[j][1], titleRow: i, rows: rows }; break; }
    }
    if (!hit) return null;
    hit.company = ''; for (i = 0; i < hit.titleRow; i++) { c = filled(rows[i]); if (c.length === 1) { hit.company = c[0].trim(); break; } }
    c = filled(rows[hit.titleRow + 1]); hit.period = c.length === 1 && cs((rows[hit.titleRow + 1] || [])[0]).trim() ? c[0].trim() : '';
    hit.headerRow = -1;
    for (i = hit.titleRow + 1; i < Math.min(rows.length, hit.titleRow + 9); i++) {
      c = filled(rows[i]); if (c.length >= 2 || (c.length === 1 && !cs((rows[i] || [])[0]).trim())) { hit.headerRow = i; break; }
    }
    hit.head = hit.headerRow < 0 ? [] : rows[hit.headerRow].map(function (x) { return cs(x).trim().toLowerCase(); });
    hit.col = function (k) { var names = QBO_COLS[k] || [k]; for (var a = 0; a < names.length; a++) { var x = hit.head.indexOf(names[a]); if (x >= 0) return x; } return -1; };
    for (i = rows.length - 1; i >= Math.max(0, rows.length - 8); i--) { var bm = /\b(accrual|cash) basis\b/i.exec(filled(rows[i]).join(' ')); if (bm) { hit.basis = bm[1].toLowerCase(); break; } }
    var nm = QBO_NAMES[hit.report], n = 0, kc;
    if (hit.headerRow < 0) return { kind: 'unknown', name: fname, label: 'QuickBooks Online ' + nm + ' with no column headings' };
    if (hit.report === 'journal' || hit.report === 'gl') {
      var dc = hit.col('date'); if (dc < 0 || hit.col('type') < 0) return { kind: 'unknown', name: fname, label: 'QuickBooks Online ' + nm + ' without Date and Transaction Type columns' };
      for (i = hit.headerRow + 1; i < rows.length; i++) if (cs((rows[i] || [])[dc]).trim()) n++;
      hit.label = 'QuickBooks Online ' + nm + ' — ' + n.toLocaleString('en-US') + (hit.report === 'journal' ? ' transactions' : ' lines');
    } else if (hit.report === 'customers' || hit.report === 'vendors' || hit.report === 'employees') {
      kc = hit.head.indexOf(hit.report.slice(0, -1)); if (kc < 0) kc = 1; hit.nameCol = kc;
      for (i = hit.headerRow + 1; i < rows.length; i++) if (kc > 0 && cs((rows[i] || [])[kc]).trim()) n++;
      hit.label = nm + (n ? ' (' + n + ')' : ' — empty (nothing to import)'); hit.empty = !n;
    } else hit.label = 'QuickBooks Online ' + nm + (hit.period ? ' · ' + hit.period : '') + (hit.report === 'tb' ? ' — the balance every account must end with' : hit.report === 'accounts' ? ' — account types' : ' — account types and balances');
    return hit;
  }
  /** Dates in one file share one order. US month/day/year unless the file itself shows a day above 12 first. */
  function dateReader(raw) {
    var dmy = false, mdy = false;
    raw.forEach(function (v) { var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(v); if (!m) return; if (+m[1] > 12) dmy = true; if (+m[2] > 12) mdy = true; });
    var flip = dmy && !mdy;
    return function (v) { var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(String(v).trim()); return m ? qbDate(flip ? m[2] + '/' + m[1] + '/' + m[3] : m[1] + '/' + m[2] + '/' + m[3]) : qbDate(String(v).trim().slice(0, 10)); };
  }
  var numText = function (v) { return cs(v).trim().replace(/^(\d+)\.0+$/, '$1'); };
  /** Journal: a transaction starts on the row that carries a date; its lines follow; rows without an account are totals. */
  function qboJournal(d, m) {
    var c = { date: d.col('date'), type: d.col('type'), num: d.col('num'), name: d.col('name'), memo: d.col('memo'), account: d.col('account'), debit: d.col('debit'), credit: d.col('credit'), cls: d.col('cls') };
    if (c.account < 0 || c.debit < 0 || c.credit < 0) { m.errors.push(d.name + ': the Journal needs the Account, Debit and Credit columns.'); return []; }
    var at = function (row, i) { return i < 0 ? '' : cs(row[i]).trim(); }, txns = [], cur = null, raw = [];
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || []; if (/^total$/i.test(cs(row[0]).trim())) break;
      var date = at(row, c.date), acc = at(row, c.account);
      if (date) { cur = { src: d.name, seq: txns.length, qbType: QBO_TXN[at(row, c.type).toLowerCase()] || at(row, c.type), rawDate: date, num: numText(row[c.num]), name: at(row, c.name), memo: '', adj: false, lines: [], rows: [] }; txns.push(cur); raw.push(date); }
      if (!cur || !acc || (at(row, c.debit) === '' && at(row, c.credit) === '')) continue;
      var memo = at(row, c.memo); if (memo && !cur.memo) cur.memo = memo;
      cur.rows.push({ account: acc, amount: cents(at(row, c.debit)) - cents(at(row, c.credit)), name: at(row, c.name), memo: memo, cls: at(row, c.cls), item: '' }); cur.lines.push(r + 1);
    }
    var rd = dateReader(raw);
    return txns.filter(function (t) {
      t.date = rd(t.rawDate);
      if (!t.date) { m.errors.push(d.name + ' line ' + (t.lines[0] || '?') + ': unreadable date "' + t.rawDate + '".'); return false; }
      var off = sum(t.rows);
      if (off) { m.errors.push(d.name + ' line ' + (t.lines[0] || '?') + ': ' + t.qbType + ' on ' + t.rawDate + ' does not balance by ' + U.fmt(off, { symbol: true }) + '. Export the Journal again for All Dates.'); return false; }
      // a deposit's "received from" stands on its first line only
      if (/^deposit$/i.test(t.qbType) && t.name) t.rows.forEach(function (x) { if (!x.name) x.name = t.name; });
      return true;
    }).map(function (t, i) { t.seq = i; delete t.rawDate; return t; });
  }
  /** Names under headings: "X" opens, "Total X" / "Total for X" closes. A parent's own subtotal ("Total for X" while
   *  "Total for X with sub-accounts" follows) does not close it. Works with or without indentation. */
  function totalsOf(rows, from) {
    var t = { plain: {}, withSubs: {} };
    for (var r = from; r < rows.length; r++) {
      var m = /^total (?:for )?(.*?)( with sub-accounts)?$/i.exec(cs((rows[r] || [])[0]).trim()); if (!m) continue;
      (m[2] ? t.withSubs : t.plain)[m[1].trim().toLowerCase()] = 1;
    }
    return t;
  }
  /** General Ledger: each line shows one side of a transaction; the account is the Account column or the heading above. */
  /** Account names in the order the General Ledger lists them. QuickBooks keeps the chart order (bank, receivable, other assets … equity, income, expenses),
   *  so the place of an account between two known ones tells what kind it is. */
  function qboLedgerOrder(d) {
    var dc = d.col('date'), stack = [], out = [];
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || [], head = cs(row[0]).trim();
      if (!head || (dc >= 0 && cs(row[dc]).trim()) || row.slice(1).some(function (c) { return cs(c).trim() !== ''; })) continue;
      var tm = /^total (?:for )?(.*?)( with sub-accounts)?$/i.exec(head);
      if (tm) { var nm = tm[1].trim().toLowerCase(); for (var k = stack.length - 1; k >= 0; k--) if (stack[k].toLowerCase() === nm) { stack.length = k; break; } continue; }
      if (/^(total|beginning balance)$/i.test(head) || /\b(accrual|cash) basis\b/i.test(head)) continue;
      stack.push(head); out.push(stack.join(':'));
    }
    return out;
  }
  function qboLedger(d, m) {
    var c = { date: d.col('date'), type: d.col('type'), num: d.col('num'), name: d.col('name'), memo: d.col('memo'), account: d.col('account'), debit: d.col('debit'), credit: d.col('credit'), cls: d.col('cls') };
    if (c.debit < 0 || c.credit < 0) { m.errors.push(d.name + ': this ' + QBO_NAMES[d.report] + ' has one Amount column, which does not say which side each line is on. Add the Debit and Credit columns to the report (or send the Journal report instead).'); return []; }
    var at = function (row, i) { return i < 0 ? '' : cs(row[i]).trim(); }, tot = totalsOf(d.rows, d.headerRow + 1), stack = [], posts = [], raw = [];
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || [], head = cs(row[0]).trim(), date = at(row, c.date);
      if (head && !date) {
        var tm = /^total (?:for )?(.*?)( with sub-accounts)?$/i.exec(head);
        if (!tm) { if (!/^(total|beginning balance)$/i.test(head) && !/\b(accrual|cash) basis\b/i.test(head)) stack.push(head); continue; }
        var nm = tm[1].trim().toLowerCase();
        if (!tm[2] && tot.withSubs[nm]) continue;                       // the parent's own subtotal
        for (var k = stack.length - 1; k >= 0; k--) if (stack[k].toLowerCase() === nm) { stack.length = k; break; }
        continue;
      }
      if (!date || !at(row, c.type)) continue;
      raw.push(date);
      posts.push({ line: r + 1, account: at(row, c.account) || stack.join(':'), type: QBO_TXN[at(row, c.type).toLowerCase()] || at(row, c.type), rawDate: date, num: numText(row[c.num]), adj: false, name: at(row, c.name), memo: at(row, c.memo), split: '', cls: at(row, c.cls), tn: '',
        amount: cents(at(row, c.debit)) - cents(at(row, c.credit)) });
    }
    var rd = dateReader(raw);
    posts = posts.filter(function (p) { p.date = rd(p.rawDate); if (!p.date) m.errors.push(d.name + ' line ' + p.line + ': unreadable date "' + p.rawDate + '".'); return !!p.date; });
    return groupsToTxns(rebuildGroups(posts, m, d.name), d.name);
  }
  /** Balance Sheet / Profit and Loss: the section an account sits in gives its type; a heading with its own
   *  "Total" line that is not a section is a parent account. → [{ NAME (full, colon-joined), ACCNTTYPE, EXTRA, bal }] */
  function qboStatement(d) {
    var rows = d.rows, tot = totalsOf(rows, d.headerRow + 1).plain, stack = [], out = [];
    var vc = d.head.indexOf('total'); if (vc < 1) vc = 1;
    for (var r = d.headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [], label = cs(row[0]).trim(), low = label.toLowerCase(), val = cs(row[vc]).trim();
      if (!label) continue;
      var tm = /^total (?:for )?(.*)$/i.exec(label);
      if (tm) { var nm = tm[1].trim().toLowerCase(); for (var k = stack.length - 1; k >= 0; k--) if (stack[k].low === nm) { stack.length = k; break; } continue; }
      var top = stack[stack.length - 1], type = '', parent = '';
      for (var j = stack.length - 1; j >= 0; j--) { if (!parent && stack[j].account) parent = stack[j].account; if (stack[j].type) { type = stack[j].type; break; } }
      var opens = tot[low] && !(val !== '' && top && top.low === low);
      if (opens && QBO_SECTION[low] && !(type && val !== '')) { stack.push({ low: low, type: QBO_SECTION[low] }); continue; }
      if (!type || /^(net income|net operating income|net other income|gross profit|net ordinary income)$/i.test(label)) { if (opens) stack.push({ low: low }); continue; }
      if (val === '' && !opens) continue;                               // a heading that is neither a section nor a parent
      var full = (parent ? parent + ':' : '') + label, v = cents(val);
      out.push({ NAME: full, ACCNTTYPE: type, EXTRA: qboExtra(label, type), bal: val === '' ? undefined : (QBO_DEBIT[type] ? v : -v) });
      if (opens) stack.push({ low: low, account: full });
    }
    return out;
  }
  function qboTrial(d) {
    var out = {}, dc = d.col('debit'), cc = d.col('credit'); if (dc < 0 || cc < 0) return out;
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || [], name = cs(row[0]).trim(); if (!name || /^total$/i.test(name)) continue;
      var a = cs(row[dc]).trim(), b = cs(row[cc]).trim(); if (a === '' && b === '') continue;
      out[name.toLowerCase()] = cents(a) - cents(b);
    }
    return out;
  }
  function qboAccountList(d, m) {
    var nc = d.head.indexOf('full name'); if (nc < 0) nc = d.head.indexOf('account'); if (nc < 0) nc = d.head.indexOf('name');
    var tc = d.head.indexOf('type'), dc = d.head.indexOf('description'), xc = d.head.indexOf('number'), out = [];
    if (nc < 0 || tc < 0) { m.warnings.push(d.name + ': the Account List needs the Name and Type columns; it was not used.'); return out; }
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || [], name = cs(row[nc]).trim(), type = qboType(row[tc]); if (!name) continue;
      if (!type) { if (cs(row[tc]).trim()) m.warnings.push(d.name + ': account "' + name + '" has the type "' + cs(row[tc]).trim() + '", which VaultBook does not know; it was left out.'); continue; }
      out.push({ NAME: name, ACCNTTYPE: type, EXTRA: qboExtra(name.split(':').pop().trim(), type), DESC: dc >= 0 ? cs(row[dc]).trim() : '', ACCNUM: xc >= 0 ? numText(row[xc]) : '' });
    }
    return out;
  }
  function qboContacts(d) {
    var h = d.head, ix = function (n) { for (var i = 0; i < n.length; i++) { var x = h.indexOf(n[i]); if (x >= 0) return x; } return -1; };
    var c = { phone: ix(['phone numbers', 'phone']), email: ix(['email']), full: ix(['full name']), addr: ix(['billing address', 'address']), ship: ix(['shipping address']), acct: ix(['account #', 'account no.']) }, out = [];
    var at = function (row, i) { return i < 0 ? '' : cs(row[i]).trim(); };
    for (var r = d.headerRow + 1; r < d.rows.length; r++) {
      var row = d.rows[r] || [], name = at(row, d.nameCol); if (!name) continue;
      var o = { NAME: name, EMAIL: at(row, c.email), PHONE1: at(row, c.phone).replace(/^phone:\s*/i, ''), CONT1: at(row, c.full), NOTE: at(row, c.acct) ? 'Account # ' + at(row, c.acct) : '' };
      o.ADDR1 = o.BADDR1 = at(row, c.addr); o.SADDR1 = at(row, c.ship);
      out.push(o);
    }
    return out;
  }
  /** Put the QuickBooks Online reports of one company together into the model. */
  function qboMerge(list, m) {
    var by = function (rep) { return list.filter(function (d) { return d.report === rep; }); }, first = function (rep) { return by(rep)[0]; };
    m.qbo = true; m.company.product = 'QuickBooks Online';
    list.forEach(function (d) { if (d.company && !m.company.name) m.company.name = d.company; if (d.basis && !m.company.basis) m.company.basis = d.basis; });
    by('customers').forEach(function (d) { m.customers = m.customers.concat(qboContacts(d)); });
    by('vendors').forEach(function (d) { m.vendors = m.vendors.concat(qboContacts(d)); });
    by('employees').forEach(function (d) { m.employees = m.employees.concat(qboContacts(d)); });
    // accounts: the Account List first, then whatever the two statements add
    var accts = [], seen = {}, add = function (a) { var k = a.NAME.toLowerCase(); if (seen[k]) { if (seen[k].bal === undefined) seen[k].bal = a.bal; return; } seen[k] = a; accts.push(a); };
    by('accounts').forEach(function (d) { qboAccountList(d, m).forEach(add); });
    ['bs', 'pnl'].forEach(function (rep) {
      by(rep).forEach(function (d) { qboStatement(d).forEach(function (a) { if (QBO_PL[a.ACCNTTYPE] && !allDates(d.period)) a.bal = undefined; add(a); }); });   // a period P&L is not an all-time total
    });
    // with a Balance Sheet and an all-dates Profit and Loss, an account on neither one can only have a zero balance
    m.qboComplete = by('bs').length > 0 && by('pnl').some(function (d) { return allDates(d.period); });
    var tb = first('tb'), tbBal = tb ? qboTrial(tb) : null;
    accts.forEach(function (a) {
      var k = a.NAME.toLowerCase(), bal = a.bal; delete a.bal;
      if (tbBal && tbBal[k] !== undefined && (!QBO_PL[a.ACCNTTYPE] || allDates(tb.period))) bal = tbBal[k];
      if (bal !== undefined) a.QBOBAL = bal;
      m.accounts.push(a);
    });
    if (tbBal) { var lost = Object.keys(tbBal).filter(function (k) { return !seen[k] && tbBal[k] !== 0; }); if (lost.length && accts.length) m.warnings.push('The Trial Balance lists ' + lost.length + ' account' + (lost.length === 1 ? '' : 's') + ' that the other reports do not: ' + lost.slice(0, 6).join(', ') + (lost.length > 6 ? '…' : '') + '.'); }
    // transactions: the Journal is exact; the General Ledger is rebuilt only when there is no Journal
    var j = by('journal'), g = by('gl');
    if (g.length) m.qboOrder = qboLedgerOrder(g[0]);
    if (j.length) {
      j.forEach(function (d) { m.txns = m.txns.concat(qboJournal(d, m)); }); m.txns.forEach(function (t, i) { t.seq = i; });
      m.source = 'QuickBooks Online Journal';
      g.forEach(function (d) { var f = m.files.find(function (x) { return x.name === d.name; }); if (f) f.label = 'QuickBooks Online General Ledger — not needed: the Journal has every transaction'; });
    } else if (g.length) {
      g.forEach(function (d) { m.txns = m.txns.concat(qboLedger(d, m)); }); m.txns.forEach(function (t, i) { t.seq = i; });
      m.source = 'QuickBooks Online General Ledger';
      if (m.txns.length) m.warnings.push('Transactions were rebuilt from the General Ledger, which lists each line without saying which lines belong together. Totals are exact, but entries on the same day may be combined. For an exact copy, add the Journal report (Reports › Journal, All Dates, export to Excel).');
    }
  }

  /* ===================== mapping tables ===================== */
  var ACC_TYPE = { BANK: 'bank', AR: 'ar', OCASSET: 'oca', FIXASSET: 'fixed', OASSET: 'oa', AP: 'ap', CCARD: 'cc', OCLIAB: 'ocl', LTLIAB: 'ltl', EQUITY: 'equity', INC: 'income', COGS: 'cogs', EXP: 'expense', EXINC: 'oi', EXEXP: 'oe' };
  var ACC_TYPE_WORDS = { 'bank': 'bank', 'accounts receivable': 'ar', 'other current asset': 'oca', 'fixed asset': 'fixed', 'other asset': 'oa', 'accounts payable': 'ap', 'credit card': 'cc', 'other current liability': 'ocl', 'long term liability': 'ltl', 'equity': 'equity', 'income': 'income', 'cost of goods sold': 'cogs', 'expense': 'expense', 'other income': 'oi', 'other expense': 'oe' };
  var SYS_EXTRA = { OPENBAL: 'OBE', RETEARNINGS: 'RE', UNDEPOSIT: 'UNDEP' };
  var ITEM_TYPE = { SERV: 'service', PART: 'inventory', INVENTORY: 'inventory', ASSEMBLY: 'inventory', INVASSEMBLY: 'inventory', NONINV: 'noninventory', NONINVENTORY: 'noninventory', OTHC: 'othercharge', OTHERCHARGE: 'othercharge', DISC: 'discount', PMT: 'payment', SUBT: 'subtotal', GRP: 'group', STAX: 'salestax', STAXGRP: 'salestax', COMPTAX: 'salestax', FIXEDASSET: 'fixedasset' };
  Q.ACC_TYPE = ACC_TYPE;
  var yes = function (v) { return /^(y|yes|true|1)$/i.test(String(v || '').trim()); };

  /* ===================== build the source model from all files ===================== */
  /**
   * files: [{ name, text, isPdf }]. Returns model:
   * { accounts[], customers[], vendors[], others[], terms[], items[], classes[], txns[], ledgerAccounts[],
   *   files[], warnings[], errors[], qbBalances{}, company }
   */
  Q.read = function (files) {
    var m = { accounts: [], customers: [], vendors: [], others: [], employees: [], terms: [], items: [], classes: [], txns: [], files: [], warnings: [], errors: [], addresses: {}, company: {}, source: '', qbo: false };
    var ledgerFiles = [], iifTrns = [], qbo = [], fullExports = [];
    (files || []).forEach(function (f) {
      var d = Q.detect(f.name, f.text, f.isPdf, f.rows);
      m.files.push({ name: f.name, kind: d.kind, label: d.label });
      if (d.kind === 'qbo') qbo.push(d);
      else if (d.kind === 'qbfull') fullExports.push(d);
      else if (d.kind === 'iif') {
        var s = d.iif.sections;
        if (d.iif.header && /^\d{4}-\d\d-\d\d$/.test(d.iif.header.DATE || '') && (d.iif.sections.ACCNT || []).length && !/General Ledger \(PDF\)/.test(d.iif.header.PROD || '')) m.listDate = d.iif.header.DATE;   // (balances taken from the ledger itself are as of the ledger: nothing can come later)   // list balances are as of the day the list was exported
        if (d.iif.header && d.iif.header.PROD) m.company.product = d.iif.header.PROD + (d.iif.header.VER ? ' ' + d.iif.header.VER : '');
        (s.ACCNT || []).forEach(function (r) { m.accounts.push(r); });
        (s.CUST || []).forEach(function (r) { m.customers.push(r); });
        (s.VEND || []).forEach(function (r) { m.vendors.push(r); });
        (s.OTHERNAME || []).forEach(function (r) { m.others.push(r); });
        (s.TERMS || []).forEach(function (r) { m.terms.push(r); });
        (s.INVITEM || []).forEach(function (r) { m.items.push(r); });
        (s.CLASS || []).forEach(function (r) { m.classes.push(r); });
        d.iif.trns.forEach(function (t) { iifTrns.push(t); });
        Object.keys(s).forEach(function (k) {
          if (!/^(ACCNT|CUST|VEND|OTHERNAME|TERMS|INVITEM|CLASS|CUSTNAMEDICT|CUSTITEMDICT|ENDCUSTNAMEDICT|ENDCUSTITEMDICT|QB ONLINE)$/.test(k) && s[k].length)
            m.warnings.push(f.name + ': list "' + k + '" (' + s[k].length + ' rows) is not imported — VaultBook has no matching list.');
        });
      } else if (d.kind === 'ledger-csv') ledgerFiles.push(d);
      else if (d.kind === 'address-txt') readAddresses(f.text, m);
    });
    // the connector's full export is complete on its own: lists, every transaction and the payment links
    if (fullExports.length) {
      var fm = OB.qbfull.toModel(fullExports[fullExports.length - 1].full);
      fm.files = m.files.slice(); if (fullExports.length > 1) fm.warnings.unshift('Several full exports were chosen; the last one is used.');
      if (m.accounts.length || m.txns.length || iifTrns.length || ledgerFiles.length || qbo.length) fm.warnings.unshift('The full export already holds everything; the other files were not used.');
      return fm;
    }
    // transactions: exact IIF transactions win over ledger reconstruction
    if (qbo.length) qboMerge(qbo, m);
    if (m.txns.length) return m;
    if (iifTrns.length) { m.txns = fromIIF(iifTrns, m); m.source = 'IIF transactions'; }
    else if (ledgerFiles.length) {
      var all = [];
      ledgerFiles.forEach(function (d) { all = all.concat(fromLedgerCSV(d.rows, d.name, m)); });
      m.txns = all; m.source = ledgerFiles.map(function (d) { return d.label; }).join(', ');
    }
    return m;
  };

  function readAddresses(text, m) {
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    var h = lines.shift().split('\t').map(function (x) { return x.trim(); });
    lines.forEach(function (l) {
      var c = l.split('\t'), r = {}; h.forEach(function (k, i) { r[k] = unq(c[i]); });
      var key = (r['Address 1'] || r['Company Name'] || '').trim().toLowerCase(); if (!key) return;
      m.addresses[key] = r;
    });
  }

  /* ---------- transactions from IIF (!TRNS/!SPL): exact grouping ---------- */
  function fromIIF(list, m) {
    return list.map(function (x, i) {
      var t = x.trns, rows = [t].concat(x.spl);
      return {
        src: 'IIF', seq: i, qbType: t.TRNSTYPE || '', date: qbDate(t.DATE), num: t.DOCNUM || '', name: t.NAME || '', memo: t.MEMO || '',
        dueDate: qbDate(t.DUEDATE), terms: t.TERMS || '', adj: false,
        rows: rows.map(function (r) { return { account: r.ACCNT || '', amount: cents(r.AMOUNT), name: r.NAME || '', memo: r.MEMO || '', cls: r.CLASS || '', item: r.INVITEM || '', qty: r.QNTY ? -(+r.QNTY) : null, price: r.PRICE ? cents(r.PRICE) : null }; })
      };
    });
  }

  /* ---------- transactions from a ledger-style CSV ---------- */
  function fromLedgerCSV(rows, fname, m) {
    var h = rows[0].map(function (x) { return x.trim().toLowerCase(); });
    var col = function (n) { return h.indexOf(n); };
    var ci = { type: col('type'), date: col('date'), num: col('num'), adj: col('adj'), name: col('name'), memo: col('memo'), split: col('split'), debit: col('debit'), credit: col('credit'), amount: col('amount'), cls: col('class'), tn: col('trans #'), account: col('account') };
    var lead = ci.type > 0 ? ci.type : 0;   // columns before "Type" hold the account headings
    var acct = '', posts = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r]; if (!row || !row.length) continue;
      var type = (row[ci.type] || '').trim();
      if (!type) {
        var head = ''; for (var k = 0; k < Math.max(1, lead); k++) if ((row[k] || '').trim()) { head = row[k].trim(); break; }
        if (head && !/^total\b/i.test(head) && head !== 'TOTAL') acct = head;
        continue;
      }
      var amt = ci.debit >= 0 ? cents(row[ci.debit]) - cents(row[ci.credit]) : cents(row[ci.amount]);
      var account = ci.account >= 0 && (row[ci.account] || '').trim() ? row[ci.account].trim() : acct;
      var date = qbDate(row[ci.date]);
      if (!date) { m.errors.push(fname + ' line ' + (r + 1) + ': unreadable date "' + row[ci.date] + '".'); continue; }
      // QuickBooks' own year-end close: one line on Retained Earnings standing for a whole year of income and expenses. Not a transaction;
      // it marks the years whose income and expense lines this ledger does not list (see rebuildGroups).
      if (/^closing entry$/i.test(type)) { if (!m.closed) m.closed = { through: date, account: acct, lone: 0, other: 0, sum: 0 }; if (date > m.closed.through) m.closed.through = date; m.closed.sum += amt; continue; }
      posts.push({ line: r + 1, account: account, type: type, date: date, num: ci.num >= 0 ? (row[ci.num] || '').trim() : '', adj: ci.adj >= 0 && /\*/.test(row[ci.adj] || ''),
        name: ci.name >= 0 ? (row[ci.name] || '').trim().replace(/^-MULTIPLE-$/i, '') : '', /* "-MULTIPLE-" means several names, not a payee */ memo: ci.memo >= 0 ? (row[ci.memo] || '').trim() : '', split: ci.split >= 0 ? (row[ci.split] || '').trim() : '',
        cls: ci.cls >= 0 ? (row[ci.cls] || '').trim() : '', tn: ci.tn >= 0 ? (row[ci.tn] || '').trim() : '', amount: amt });
    }
    return groupsToTxns(ci.tn >= 0 ? groupByTransNo(posts) : rebuildGroups(posts, m, fname), fname);
  }
  function groupsToTxns(groups, fname) {
    return groups.map(function (g, i) {
      var first = g[0], anchor = g.find(function (p) { return p.name; }) || first;
      var memo = (g.find(function (p) { return p.memo && !/^-?MULTIPLE-?$/i.test(p.memo); }) || {}).memo || '';
      return { src: fname, seq: i, qbType: first.type, date: first.date, num: first.num, name: anchor.name, memo: memo, adj: g.some(function (p) { return p.adj; }),
        lines: g.map(function (p) { return p.line; }),
        rows: g.map(function (p) { return { account: p.account, amount: p.amount, name: p.name, memo: p.memo, cls: p.cls, item: '', rebuilt: !!p.rebuilt }; }) };
    });
  }
  function groupByTransNo(posts) {
    var g = {}, order = [];
    posts.forEach(function (p) { var k = p.tn || ('line' + p.line); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(p); });
    return order.map(function (k) { return g[k]; });
  }
  var sum = function (a) { return a.reduce(function (s, p) { return s + p.amount; }, 0); };
  /**
   * A General Ledger lists each transaction once per account it touches, without a transaction id.
   * Rebuild transactions: group by (type, date, num, name); merge groups that only balance together
   * (journal lines with different names); then split groups that hold several same-looking transactions
   * (two invoices with the same number, two identical checks) using their anchor lines (A/R, A/P, bank).
   */
  function rebuildGroups(posts, m, fname) {
    var byKey = {}, order = [];
    posts.forEach(function (p) { var k = [p.type, p.date, p.num, p.name].join('\u0001'); if (!byKey[k]) { byKey[k] = []; order.push(k); } byKey[k].push(p); });
    var groups = order.map(function (k) { return byKey[k]; });
    var balanced = groups.filter(function (g) { return sum(g) === 0; });
    var loose = groups.filter(function (g) { return sum(g) !== 0; });
    [function (p) { return [p.type, p.date, p.num].join('\u0001'); }, function (p) { return [p.type, p.date].join('\u0001'); }, function (p) { return p.date; }].forEach(function (keyFn) {
      if (!loose.length) return;
      var bucket = {}, keys = [];
      loose.forEach(function (g) { var k = keyFn(g[0]); if (!bucket[k]) { bucket[k] = []; keys.push(k); } bucket[k].push(g); });
      var next = [];
      keys.forEach(function (k) {
        var gs = bucket[k], merged = [].concat.apply([], gs);
        if (gs.length > 1 && sum(merged) === 0) balanced.push(merged); else next = next.concat(gs);
      });
      loose = next;
    });
    // Closed years: the ledger lists the bank, card and loan side of each transaction but not its income or expense side (QuickBooks shows
    // those years only as a Closing Entry). The Split column of each one-sided line names the account on the missing side, so put it back.
    if (m.closed) {
      var leaf = function (n) { return String(n || '').toLowerCase().split(':').pop().replace(/ - other$/, '').trim(); };
      var counter = function (p, account, amount) { return { rebuilt: true, line: p.line, account: account, type: p.type, date: p.date, num: p.num, adj: p.adj, name: p.name, memo: p.memo, split: p.account, cls: p.cls, tn: '', amount: amount }; };
      var listed = {}; posts.forEach(function (p) { if (p.date <= m.closed.through) listed[leaf(p.account)] = 1; });   // accounts the ledger does list in closed years: their other side is never missing
      var open = [], rest = [];
      loose.forEach(function (g) {
        if (g[0].date > m.closed.through) { open.push(g); return; }
        // 1. a line whose Split names an account the ledger omits gets that account back, as its own two-line transaction
        var left = g.filter(function (p) {
          if (!p.split || /^-?split-?$/i.test(p.split) || listed[leaf(p.split)]) return true;
          m.closed.lone++; balanced.push([p, counter(p, p.split, -p.amount)]); return false;
        });
        if (left.length) { if (sum(left) === 0) balanced.push(left); else rest.push(left); }
      });
      // 2. what is left may pair up across the groups it was first sorted into (the two halves of a transfer)
      [function (p) { return [p.type, p.date, p.num].join('\u0001'); }, function (p) { return p.date + '\u0001' + Math.abs(sum([p])); }, function (p) { return p.date; }].forEach(function (keyFn) {
        var bucket = {}, keys = [], next = [];
        rest.forEach(function (g) { var k = keyFn(g.length === 1 ? g[0] : { type: g[0].type, date: g[0].date, num: g[0].num, amount: sum(g) }); if (!bucket[k]) { bucket[k] = []; keys.push(k); } bucket[k].push(g); });
        keys.forEach(function (k) { var gs = bucket[k], merged = [].concat.apply([], gs); if (gs.length > 1 && sum(merged) === 0) balanced.push(merged); else next = next.concat(gs); });
        rest = next;
      });
      // 3. still one-sided: the missing side spans several accounts ("-SPLIT-"); the ledger keeps it only inside Retained Earnings
      rest.forEach(function (g) { m.closed.other++; m.closed.otherAmt = (m.closed.otherAmt || 0) + Math.abs(sum(g)); balanced.push(g.concat([counter(g[0], m.closed.account || 'Retained Earnings', -sum(g))])); });
      loose = open;
      if ((m.closed.lone || m.closed.other) && !m.closed.told) {
        m.closed.told = true;
        m.warnings.push(fname + ': years through ' + U.fmtDate(m.closed.through) + ' are closed in this ledger. QuickBooks lists their income and expense lines only as year-end closing entries, so ' + m.closed.lone +
          ' income and expense lines were put back from the Split column of the bank, card and loan lines' + (m.closed.other ? '. ' + m.closed.other + ' transactions (' + U.fmt(m.closed.otherAmt, { symbol: true }) + ') split their missing side over several accounts ("-SPLIT-"), which the ledger does not name; they were posted to ' + (m.closed.account || 'Retained Earnings') + ', so balances are right but those years\' income and expense by account are incomplete. For full detail, export the General Ledger one fiscal year at a time' : '') + '.');
      }
    }
    loose.forEach(function (g) {
      m.errors.push(fname + ': ' + g[0].type + ' ' + (g[0].num || '') + ' on ' + g[0].date + ' (' + (g[0].name || 'no name') + ') does not balance by ' + U.fmt(sum(g), { symbol: true }) + ' — lines ' + g.map(function (p) { return p.line; }).join(', ') + '. Export the full General Ledger (all dates, all accounts).');
    });
    // keep source order (first line of each group)
    balanced.sort(function (a, b) { return Math.min.apply(null, a.map(function (p) { return p.line; })) - Math.min.apply(null, b.map(function (p) { return p.line; })); });
    var out = [];
    balanced.forEach(function (g) { pairBySplit(g).forEach(function (h) { splitByAnchors(h).forEach(function (x) { out.push(x); }); }); });
    return out;
  }
  /** Two-line transactions that were only grouped because they share a type, date and name (several deposits on one day): a line and the
   *  line that mirrors it (opposite amount, each naming the other's account in Split) are one transaction. A printed ledger cuts the
   *  Split text short and shows only the last part of a sub-account's name, so a cut name matches by its beginning. Journals are left whole. */
  function pairBySplit(g) {
    if (g.length < 4 || /journal/i.test(g[0].type)) return [g];
    var names = function (split, a) { var sp = String(split || '').toLowerCase(), lf = String(a).toLowerCase().split(':').pop(); return !!sp && !/^-?split-?$/.test(sp) && (sp === String(a).toLowerCase() || sp === lf || (sp.length >= 6 && lf.indexOf(sp) === 0)); };
    var used = g.map(function () { return false; }), pairs = [];
    g.forEach(function (p, i) {
      if (used[i] || !p.amount) return;
      for (var k = i + 1; k < g.length; k++) { var q = g[k]; if (!used[k] && q.amount === -p.amount && q.account !== p.account && names(p.split, q.account) && names(q.split, p.account)) { used[i] = used[k] = true; pairs.push([p, q]); break; } }
    });
    if (!pairs.length) return [g];
    var rest = g.filter(function (p, i) { return !used[i]; });
    return rest.length ? pairs.concat([rest]) : pairs;
  }
  /** Split a balanced group holding several transactions: one per anchor line (A/R, A/P or the bank/card head). */
  function splitByAnchors(g) {
    var acct = function (p) { return p.account.toLowerCase(); };
    var isAR = function (p) { return /accounts receivable|^a\/r\b/.test(acct(p)); };
    var isAP = function (p) { return /accounts payable|^a\/p\b/.test(acct(p)); };
    var anchors = g.filter(isAR);
    if (anchors.length < 2) anchors = g.filter(isAP);
    if (anchors.length < 2) {
      var counts = {}; g.forEach(function (p) { counts[p.account] = (counts[p.account] || 0) + 1; });
      var many = Object.keys(counts).filter(function (a) { return counts[a] > 1; });
      // the head account is the one other lines name in their Split column
      var head = many.find(function (a) { return g.some(function (p) { return p.split === a; }); });
      anchors = head ? g.filter(function (p) { return p.account === head; }) : [];
      if (anchors.length < 2) return [g];
    }
    var rest = g.filter(function (p) { return anchors.indexOf(p) < 0; });
    if (rest.length > 22) return [g];
    var used = rest.map(function () { return false; }), parts = [];
    for (var a = 0; a < anchors.length; a++) {
      var pick = subset(rest, used, -anchors[a].amount);
      if (!pick) return [g];
      pick.forEach(function (i) { used[i] = true; });
      parts.push([anchors[a]].concat(pick.map(function (i) { return rest[i]; })));
    }
    if (used.some(function (u) { return !u; })) return [g];
    return parts;
  }
  function subset(rows, used, target) {
    var idx = []; rows.forEach(function (r, i) { if (!used[i]) idx.push(i); });
    var best = null;
    (function dfs(k, acc, s) {
      if (best) return;
      if (s === target && acc.length) { best = acc.slice(); return; }
      for (var j = k; j < idx.length; j++) { acc.push(idx[j]); dfs(j + 1, acc, s + rows[idx[j]].amount); acc.pop(); if (best) return; }
    })(0, [], 0);
    return best;
  }

  /* ===================== plan: map the model onto a VaultBook company ===================== */
  /**
   * plan(model, book, opts) → { bundle, preview, warnings, errors, expected }
   * opts.openingBalanceDate: date for an opening-balance entry when QuickBooks balances are not fully
   * explained by the imported transactions (default: day before the first transaction).
   * opts.openingBalances: 'post' (default) | 'skip'
   */
  Q.plan = function (model, book, opts) {
    opts = opts || {};
    var warn = model.warnings.slice(), errs = model.errors.slice(), uid = U.uid;
    var res = { accounts: [], contacts: [], items: [], classes: [], transactions: [] };
    var now = new Date().toISOString();

    /* ---- accounts ---- */
    var accByQB = {}, leafIndex = {}, existingByName = {}, used = {};
    book.accounts.forEach(function (a) { existingByName[a.name.toLowerCase()] = a; });
    var sysByCode = {}; book.accounts.forEach(function (a) { if (a.system) sysByCode[a.system] = a; });
    var numbersTaken = {}; // number -> account id
    var vbAccounts = book.accounts.map(function (a) { return U.clone(a); }), vbById = {};
    vbAccounts.forEach(function (a) { vbById[a.id] = a; if (a.number) numbersTaken[a.number] = a.id; });
    var touched = {}, firstAR = null, firstAP = null;
    // QuickBooks Online leaves accounts with a zero balance off the Balance Sheet and Profit and Loss, yet the Journal still posts to them
    // (a fully paid Accounts Receivable is the usual one). Give those a type from the name, or Other Current Asset, and say so.
    if (model.qbo && model.qboComplete && model.accounts.length) {
      var known = {}, zeroAdded = [], SEQ = ['BANK', 'AR', 'OCASSET', 'FIXASSET', 'OASSET', 'AP', 'CCARD', 'OCLIAB', 'LTLIAB', 'EQUITY', 'INC', 'COGS', 'EXP', 'EXINC', 'EXEXP'];
      var leafOf = function (k) { return k.split(':').pop().trim(); };
      model.accounts.forEach(function (r) { if (!r.NAME) return; var k = r.NAME.toLowerCase(); known[k] = r.ACCNTTYPE; if (!known[leafOf(k)]) known[leafOf(k)] = r.ACCNTTYPE; });
      var order = (model.qboOrder || []).map(function (x) { return x.toLowerCase(); }), typeAt = function (i) { return known[order[i]] || known[leafOf(order[i])]; };
      var placed = function (k) {   // the types of the nearest known accounts before and after this one in the General Ledger
        var at = order.indexOf(k); if (at < 0) at = order.map(leafOf).indexOf(leafOf(k)); if (at < 0) return null;
        var lo = 0, hi = SEQ.length - 1, a, b;
        for (a = at - 1; a >= 0; a--) if (typeAt(a)) { lo = SEQ.indexOf(typeAt(a)); break; }
        for (b = at + 1; b < order.length; b++) if (typeAt(b)) { hi = SEQ.indexOf(typeAt(b)); break; }
        return lo <= hi ? { lo: lo, hi: hi, prev: a >= 0 ? leafOf(order[a]) : '' } : null;
      };
      model.txns.forEach(function (t) { t.rows.forEach(function (r) {
        var n = (r.account || '').trim(), k = n.toLowerCase(); if (!n || known[k] || known[leafOf(k)] || known[k.replace(/ - other$/, '')]) return;
        var leaf = leafOf(k), parent = k.indexOf(':') > 0 ? known[k.slice(0, k.lastIndexOf(':'))] : '';
        var hint = /accounts receivable|\(a\/r\)/.test(leaf) ? 'AR' : /accounts payable|\(a\/p\)/.test(leaf) ? 'AP' : /undeposited funds|payments to deposit/.test(leaf) ? 'OCASSET' : /credit card|\bcc\b/.test(leaf) ? 'CCARD' : /\bloan\b|payable|liabilit/.test(leaf) ? 'OCLIAB' : '';
        var pl = placed(k), inRange = function (ty) { return pl && SEQ.indexOf(ty) >= pl.lo && SEQ.indexOf(ty) <= pl.hi; }, type, how;
        if (parent) { type = parent; how = 'same as its parent account'; }
        else if (!pl) { type = hint || 'OCASSET'; how = hint ? 'from its name' : 'not in the General Ledger either'; }
        else if (pl.lo === pl.hi) { type = SEQ[pl.lo]; how = 'from its place in the General Ledger'; }
        else if (hint && inRange(hint)) { type = hint; how = 'from its name and place in the General Ledger'; }
        else { type = inRange('OCASSET') ? 'OCASSET' : leaf.localeCompare(pl.prev) >= 0 ? SEQ[pl.lo] : SEQ[pl.hi]; how = 'from its place in the General Ledger, between ' + S.TYPE[ACC_TYPE[SEQ[pl.lo]]].label + ' and ' + S.TYPE[ACC_TYPE[SEQ[pl.hi]]].label; }
        model.accounts.push({ NAME: n, ACCNTTYPE: type, EXTRA: qboExtra(n.split(':').pop().trim(), type), QBOBAL: 0 }); known[k] = type; known[leaf] = type;
        zeroAdded.push(n + ' as ' + S.TYPE[ACC_TYPE[type]].label + ' (' + how + ')');
      }); });
      if (zeroAdded.length) warn.push(zeroAdded.length + ' account' + (zeroAdded.length === 1 ? ' has' : 's have') + ' a zero balance, so QuickBooks left ' + (zeroAdded.length === 1 ? 'it' : 'them') + ' off the Balance Sheet and Profit and Loss. Imported: ' + zeroAdded.join('; ') + '. Change the type in the Chart of Accounts if needed.');
    }
    var qbAccounts = model.accounts.filter(function (r) { return r.NAME; });
    qbAccounts.sort(function (x, y) { return x.NAME.split(':').length - y.NAME.split(':').length; });
    var expected = {}; // QuickBooks current balance per QB account (from the list export)
    qbAccounts.forEach(function (r) {
      var full = r.NAME, parts = full.split(':'), leaf = parts[parts.length - 1], qbt = String(r.ACCNTTYPE || '').toUpperCase();
      if (qbt === 'NONPOSTING') { warn.push('Non-posting account "' + full + '" (estimates, sales/purchase orders) is not imported — VaultBook has no non-posting documents.'); return; }
      var type = ACC_TYPE[qbt] || ACC_TYPE_WORDS[String(r.ACCNTTYPE || '').toLowerCase()];
      if (!type) { errs.push('Account "' + full + '" has an unknown type "' + r.ACCNTTYPE + '".'); return; }
      if (type === 'ar') { if (firstAR) { warn.push('Second A/R account "' + full + '" is imported as an Other Current Asset — VaultBook keeps one A/R account.'); type = 'oca'; } else firstAR = full; }
      if (type === 'ap') { if (firstAP) { warn.push('Second A/P account "' + full + '" is imported as an Other Current Liability — VaultBook keeps one A/P account.'); type = 'ocl'; } else firstAP = full; }
      var parent = parts.length > 1 ? accByQB[parts.slice(0, -1).join(':').toLowerCase()] : null;
      var target = null;
      var sysCode = type === 'ar' ? 'AR' : type === 'ap' ? 'AP' : SYS_EXTRA[String(r.EXTRA || '').toUpperCase()];
      if (sysCode && sysByCode[sysCode] && !touched[sysByCode[sysCode].id]) target = vbById[sysByCode[sysCode].id];
      if (!target && !parent) {
        var ex = existingByName[leaf.toLowerCase()];
        if (ex && !touched[ex.id] && (!ex.system || ex.type === type)) target = vbById[ex.id];
      }
      if (target && target.system && target.type !== type) target = null;
      if (!target) { target = { id: uid('acct'), system: '', active: true }; vbAccounts.push(target); vbById[target.id] = target; }
      touched[target.id] = true;
      if (parent && parent.type !== type) { warn.push('Sub-account "' + full + '" has a different type from its parent; imported as a top-level account.'); parent = null; }
      // a QuickBooks account may share its name with a VaultBook system account of another kind ("Sales Tax Payable" kept as an expense): keep both, tell them apart
      var clash = !parent && existingByName[leaf.toLowerCase()], shown = leaf;
      if (clash && clash.id !== target.id) { shown = leaf + ' (' + S.TYPE[type].label + ')'; warn.push('QuickBooks account "' + leaf + '" has the same name as VaultBook\'s own ' + S.TYPE[clash.type].label + ' account; imported as "' + shown + '".'); }
      target.name = shown; target.type = type; target.parentId = parent ? parent.id : '';
      target.description = r.DESC || target.description || '';
      var num = String(r.ACCNUM || '').trim();
      if (num) {
        var holder = numbersTaken[num];
        if (holder && holder !== target.id) { if (touched[holder]) { warn.push('Account number ' + num + ' is used twice in QuickBooks; kept on the first account only.'); num = ''; } else vbById[holder].number = ''; }
        if (num) numbersTaken[num] = target.id;
      }
      if (target.number && numbersTaken[target.number] === target.id && target.number !== num) delete numbersTaken[target.number];
      target.number = num;
      target.qbHidden = yes(r.HIDDEN);
      target.active = true;
      accByQB[full.toLowerCase()] = target;
      (leafIndex[leaf.toLowerCase()] = leafIndex[leaf.toLowerCase()] || []).push(target);
      if (r.QBOBAL !== undefined) expected[target.id] = r.QBOBAL;         // QuickBooks Online: Trial Balance, debit + / credit −
      else if (r.OBAMOUNT !== undefined && r.OBAMOUNT !== '') expected[target.id] = cents(r.OBAMOUNT);
    });
    // names a ledger may use: full name, leaf name (when unique), "Parent - Other", "1000 · Name"
    var resolveAccount = function (name) {
      var n = String(name || '').trim(); if (!n) return null;
      var m1 = /^(\S+)\s+·\s+(.*)$/.exec(n); if (m1) n = m1[2];
      var low = n.toLowerCase();
      if (accByQB[low]) return accByQB[low];
      // "Salaries & Wages - Other" in a ledger is the parent account itself (the part not in its sub-accounts); the ledger prints only the leaf name
      var other = /^(.*) - other$/i.exec(n);
      if (other) { var ol = other[1].trim().toLowerCase(); if (accByQB[ol]) return accByQB[ol]; if (leafIndex[ol] && leafIndex[ol].length === 1) return leafIndex[ol][0]; }
      if (leafIndex[low] && leafIndex[low].length === 1) return leafIndex[low][0];
      if (/^(no accnt|no account)$/i.test(n)) return null;
      return null;
    };

    /* ---- terms ---- */
    var termDays = {};
    model.terms.forEach(function (t) {
      var days = t.STDDUEDAYS !== undefined && t.STDDUEDAYS !== '' ? +t.STDDUEDAYS : null;
      if (String(t.TERMSTYPE) === '1') { warn.push('Payment terms "' + t.NAME + '" are date-driven; customers using them get ' + (t.DAYOFMONTHDUE || 30) + ' days.'); days = +t.DAYOFMONTHDUE || 30; }
      if (cents(t.DISCPER) && +t.STDDISCDAYS) warn.push('Early-payment discount in terms "' + t.NAME + '" (' + t.DISCPER + ' in ' + t.STDDISCDAYS + ' days) is kept as the term name only — VaultBook does not calculate discounts.');
      termDays[String(t.NAME).toLowerCase()] = days === null || isNaN(days) ? null : days;
    });
    var daysFor = function (name) { var d = termDays[String(name || '').toLowerCase()]; return d === undefined || d === null ? (/due on receipt/i.test(name || '') ? 0 : null) : d; };

    /* ---- contacts ---- */
    var custByName = {}, vendByName = {}, contacts = [];
    book.contacts.forEach(function (c) { (c.kind === 'customer' ? custByName : vendByName)[c.name.toLowerCase()] = c; });
    var addrLines = function (r, prefix, name) {
      var a = [1, 2, 3, 4, 5].map(function (i) { return (r[prefix + i] || '').trim(); }).filter(Boolean);
      if (a.length && (a[0].toLowerCase() === String(name || '').toLowerCase() || a[0].toLowerCase() === String(r.COMPANYNAME || '').toLowerCase())) a.shift();
      return a.join('\n');
    };
    var mkContact = function (kind, r, nameOverride) {
      var name = (nameOverride || r.NAME || '').trim(); if (!name) return null;
      var map = kind === 'customer' ? custByName : vendByName;
      if (map[name.toLowerCase()]) return map[name.toLowerCase()];
      var c = { id: uid(kind === 'customer' ? 'cus' : 'ven'), kind: kind, name: name, active: !yes(r.HIDDEN), createdAt: now };
      c.company = r.COMPANYNAME || ''; c.email = r.EMAIL || ''; c.phone = r.PHONE1 || ''; c.taxId = r.TAXID || '';
      c.address = kind === 'customer' ? addrLines(r, 'BADDR', name) : addrLines(r, 'ADDR', name);
      var al = model.addresses[name.toLowerCase()];
      if (!c.address && al) c.address = [al['Address 2'], al['Address 3'], al['Address 4']].filter(Boolean).join('\n');
      c.notes = [r.NOTE, r.NOTEPAD].filter(Boolean).join('\n');
      S.CONTACT_EXTRA.forEach(function (k) { c[k] = ''; });
      c.firstName = r.FIRSTNAME || ''; c.lastName = r.LASTNAME || ''; c.contactName = r.CONT1 || ''; c.altPhone = r.PHONE2 || ''; c.fax = r.FAXNUM || '';
      c.shipAddress = kind === 'customer' ? addrLines(r, 'SADDR', name) : '';
      c.creditLimit = r.LIMIT || ''; c.type = r.CTYPE || r.VTYPE || ''; c.paymentTerms = r.TERMS || '';
      var d = daysFor(r.TERMS); c.terms = d === null ? (book.company.defaultTerms === undefined ? 30 : book.company.defaultTerms) : d;
      c.is1099 = kind === 'vendor' && yes(r['1099']);
      if (name.indexOf(':') > 0 && kind === 'customer') c.notes = (c.notes ? c.notes + '\n' : '') + 'QuickBooks job of ' + name.split(':')[0];
      map[name.toLowerCase()] = c; contacts.push(c);
      return c;
    };
    model.customers.forEach(function (r) { mkContact('customer', r); });
    model.vendors.forEach(function (r) { mkContact('vendor', r); });
    (model.employees || []).forEach(function (r) { var c = mkContact('vendor', r); if (c) c.notes = (c.notes ? c.notes + '\n' : '') + 'QuickBooks employee (kept as a payee; VaultBook has no payroll).'; });
    model.others.forEach(function (r) { var c = mkContact('vendor', r); if (c) c.notes = (c.notes ? c.notes + '\n' : '') + 'QuickBooks "Other name" (imported as a vendor/payee).'; });
    var autoCreated = [];
    var contactFor = function (name, kind) {
      var n = String(name || '').trim(); if (!n) return null;
      var low = n.toLowerCase();
      if (kind === 'customer') return custByName[low] || (autoCreated.push(n), mkContact('customer', {}, n));
      if (kind === 'vendor') return vendByName[low] || (autoCreated.push(n), mkContact('vendor', {}, n));
      return vendByName[low] || custByName[low] || (autoCreated.push(n), mkContact('vendor', {}, n));
    };

    /* ---- classes ---- */
    var classByName = {}; (book.classes || []).forEach(function (c) { classByName[c.name.toLowerCase()] = c; });
    var classes = [];
    var classFor = function (name, hidden) {
      var n = String(name || '').trim(); if (!n) return '';
      var parts = n.split(':'), parentId = '', c = null;
      parts.forEach(function (p, i) {
        var key = parts.slice(0, i + 1).join(':').toLowerCase();
        c = classByName[key];
        if (!c) { c = { id: uid('cls'), name: p, parentId: parentId, description: '', active: !hidden, createdAt: now }; classByName[key] = c; classes.push(c); }
        parentId = c.id;
      });
      return c.id;
    };
    model.classes.forEach(function (r) { classFor(r.NAME, yes(r.HIDDEN)); });

    /* ---- items ---- */
    var items = [], itemByName = {}, itemByDesc = {};
    (book.items || []).forEach(function (x) { itemByName[x.name.toLowerCase()] = x; });
    model.items.forEach(function (r) {
      var name = (r.NAME || '').trim(); if (!name || itemByName[name.toLowerCase()]) return;
      var code = String(r.INVITEMTYPE || '').toUpperCase(), type = ITEM_TYPE[code] || 'othercharge';
      if (!ITEM_TYPE[code]) warn.push('Item "' + name + '" has QuickBooks type "' + r.INVITEMTYPE + '"; imported as an Other charge.');
      var inc = resolveAccount(r.ACCNT), exp = resolveAccount(r.COGSACCNT) || null, asset = resolveAccount(r.ASSETACCNT) || null;
      var it = { id: uid('item'), name: name, type: type, sku: '', description: r.DESC || '', purchaseDescription: r.PURCHASEDESC || '',
        incomeAccountId: inc ? inc.id : '', expenseAccountId: exp ? exp.id : '', assetAccountId: asset ? asset.id : '',
        price: r.PRICE !== undefined && r.PRICE !== '' ? cents(r.PRICE) : null, cost: r.COST !== undefined && r.COST !== '' ? cents(r.COST) : null,
        taxable: yes(r.TAXABLE), active: !yes(r.HIDDEN), createdAt: now };
      if (type === 'inventory') it.notes = 'QuickBooks inventory part: VaultBook records sales and purchases through the item accounts but does not track quantities on hand.';
      items.push(it); itemByName[name.toLowerCase()] = it;
      var dk = (it.description || '').trim().toLowerCase();
      if (dk) (itemByDesc[dk] = itemByDesc[dk] || []).push(it);
    });
    if (items.some(function (x) { return x.type === 'inventory'; })) warn.push('Inventory items are imported for invoicing, but VaultBook does not track quantity on hand or average cost.');

    /* ---- transactions ---- */
    var missingAcc = {};
    var mapped = model.txns.map(function (t) {
      var rows = t.rows.map(function (r) {
        var a = resolveAccount(r.account);
        if (!a) { missingAcc[r.account || '(blank)'] = (missingAcc[r.account || '(blank)'] || 0) + 1; }
        return { acc: a, amount: r.amount, name: r.name, memo: /^-?MULTIPLE-?$/i.test(r.memo || '') ? '' : (r.memo || ''), cls: r.cls, item: r.item, qty: r.qty, price: r.price };
      });
      return { t: t, rows: rows };
    });
    if (model.qbo && !qbAccounts.length && Object.keys(missingAcc).length) { errs.push('These files have the transactions but do not say what kind each account is (bank, income, expense…). Add the Balance Sheet and the Profit and Loss for All Dates (Excel), or the Account List.'); missingAcc = {}; }
    Object.keys(missingAcc).forEach(function (n) { if (model.qbo) { errs.push('Account "' + n + '" is used by ' + missingAcc[n] + ' line' + (missingAcc[n] === 1 ? '' : 's') + ' but is on neither the Balance Sheet nor the Profit and Loss in these files. Add both reports for All Dates (or the Account List).'); return; } errs.push('Account "' + n + '" is used by ' + missingAcc[n] + ' ledger line' + (missingAcc[n] === 1 ? '' : 's') + ' but is not in the chart of accounts file. Add the Chart of Accounts IIF export.'); });
    var drafts = [], kinds = {}, skipped = [];
    var TYPE_ORDER = { invoice: 1, creditMemo: 1, salesReceipt: 1, bill: 1, vendorCredit: 1, deposit: 2, check: 2, expense: 2, ccCredit: 2, transfer: 2, journal: 2, payment: 3, billPayment: 3, customerRefund: 4 };
    if (!errs.length) mapped.forEach(function (x) {
      var d = toDraft(x.t, x.rows, contactFor, classFor, itemByName, itemByDesc, daysFor, warn);
      if (!d) { skipped.push(x.t); return; }
      d.importRef = 'QuickBooks ' + x.t.qbType + (x.t.num ? ' ' + x.t.num : '') + ' · ' + x.t.date + (x.t.lines ? ' · ' + x.t.src + ' lines ' + x.t.lines.join(',') : '') + (x.t.qbTxnId ? ' · TxnID ' + x.t.qbTxnId : '');
      d._sort = TYPE_ORDER[d.type] || 2; d._seq = x.t.seq; d._qb = x.t;
      kinds[d.type] = (kinds[d.type] || 0) + 1;
      drafts.push(d);
    });
    if (warn.earlyDue) warn.push('QuickBooks had a due date earlier than the document date on ' + warn.earlyDue.length + ' document' + (warn.earlyDue.length === 1 ? '' : 's') + '; the document date is used as the due date: ' + warn.earlyDue.slice(0, 6).join(', ') + (warn.earlyDue.length > 6 ? ' and ' + (warn.earlyDue.length - 6) + ' more' : '') + '.');
    if (skipped.length) warn.push(skipped.length + ' zero-amount QuickBooks transaction' + (skipped.length === 1 ? ' was' : 's were') + ' skipped (nothing to post).');
    drafts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a._sort - b._sort) || (a._seq - b._seq); });
    // VaultBook keeps document numbers unique per type; QuickBooks allows repeats. Suffix repeats (-2, -3 …).
    var seenNo = {}, renamed = [];
    drafts.forEach(function (d) {
      if (!d.number || ['invoice', 'creditMemo', 'salesReceipt', 'journal', 'check'].indexOf(d.type) < 0) return;
      var k = d.type + '|' + d.number.toLowerCase();
      if (!seenNo[k]) { seenNo[k] = 1; return; }
      var n = ++seenNo[k], nn = d.number + '-' + n;
      while (seenNo[d.type + '|' + nn.toLowerCase()]) nn = d.number + '-' + (++n);
      seenNo[d.type + '|' + nn.toLowerCase()] = 1; d._origNumber = d.number; renamed.push(S.TXN_TYPES[d.type].label + ' ' + d.number + ' → ' + nn); d.number = nn;
    });
    if (renamed.length) warn.push('QuickBooks used some document numbers twice; VaultBook needs unique numbers, so repeats were renamed: ' + renamed.slice(0, 6).join(', ') + (renamed.length > 6 ? ' and ' + (renamed.length - 6) + ' more' : '') + '.');
    var applied = applyPayments(drafts, warn);

    /* ---- opening balance for balances the transactions do not explain ---- */
    var activity = {};
    drafts.forEach(function (d) { d._posts.forEach(function (p) { activity[p.accountId] = (activity[p.accountId] || 0) + p.amount; }); });
    /* ---- closed years: an all-dates Profit and Loss gives each account's exact total, so the part parked in Retained Earnings can go to its accounts ---- */
    var closedDraft = null;
    if (model.closed && model.closed.other && drafts.length) {
      var reAcc = resolveAccount(model.closed.account || 'Retained Earnings'), firstD = drafts.reduce(function (mn, d) { return d.date < mn ? d.date : mn; }, '9999'), lastD = drafts.reduce(function (mx, d) { return d.date > mx ? d.date : mx; }, '');
      var pl = null; (opts.reportTexts || []).forEach(function (t) { var r = Q.statementTotals(t, accByQB); if (r && r.kind === 'pnl' && (r.all || (r.from && r.to && r.from <= firstD && r.to >= lastD))) pl = r; });
      if (pl && reAcc) {
        var jl2 = [], net = 0;
        vbAccounts.forEach(function (a) {
          if (!touched[a.id] || S.isBS(a.type)) return;
          var want = (pl.byId[a.id] || 0) * (S.TYPE[a.type].normal === 'D' ? 1 : -1), d = want - (activity[a.id] || 0);
          if (d) { jl2.push({ accountId: a.id, debit: d > 0 ? d : 0, credit: d < 0 ? -d : 0, memo: 'Closed years: total from the QuickBooks Profit and Loss' }); net += d; }
        });
        // proof: after the move, Retained Earnings must hold exactly what the ledger shows for it without QuickBooks' own closing entries
        var reLedger = 0; model.txns.forEach(function (t) { t.rows.forEach(function (r) { if (!r.rebuilt && resolveAccount(r.account) === reAcc) reLedger += r.amount; }); });
        if (jl2.length && (activity[reAcc.id] || 0) - net === reLedger) {
          jl2.push({ accountId: reAcc.id, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, memo: 'Closed years: income and expenses the ledger showed only inside Retained Earnings' });
          closedDraft = { type: 'journal', date: model.closed.through, number: 'QB-CLOSED', memo: 'Closed years: income and expense totals by account from the QuickBooks Profit and Loss (the ledger lists these years only as closing entries)', jlines: jl2, importRef: 'QuickBooks closed years' };
          drafts.push(closedDraft); jl2.forEach(function (l) { activity[l.accountId] = (activity[l.accountId] || 0) + l.debit - l.credit; });
          warn.push('Closed years: the Profit and Loss report covers all dates, so each income and expense account was brought to its QuickBooks total with one entry (QB-CLOSED, ' + U.fmtDate(model.closed.through) + ', ' + (jl2.length - 1) + ' accounts). All-time totals by account now equal QuickBooks; how they fall between the closed years is approximate.');
        } else if (jl2.length) warn.push('The Profit and Loss report could not be used to complete the closed years: its totals do not agree with the ledger\'s Retained Earnings. Check that it covers all dates and the same basis.');
      }
    }
    var diffs = [];
    Object.keys(expected).forEach(function (id) {
      var a = vbById[id]; if (!a || !S.isBS(a.type)) return;               // P&L list balances are period figures; balance sheet only
      var sign = S.TYPE[a.type].normal === 'D' ? 1 : -1;
      var qb = expected[id] * 1;                                           // IIF list amounts are signed like debits(+)/credits(-)
      var have = activity[id] || 0;
      if (qb !== have) diffs.push({ accountId: id, name: a.name, type: a.type, qb: qb, imported: have, diff: qb - have, sign: sign });
    });
    var obDraft = null;
    var firstDate = drafts.length ? drafts[0].date : (opts.openingBalanceDate || U.today());
    // The list file carries balances as of its export day. When the transactions stop well before that day, the differences are simply
    // the later activity, not opening balances: do not post them unless the user asks.
    var lastDate = drafts.reduce(function (mx, d) { return d.date > mx ? d.date : mx; }, ''), later = !!(diffs.length && model.listDate && lastDate && U.daysBetween(lastDate, model.listDate) > 45);
    var openingMode = opts.openingBalances === 'post' || opts.openingBalances === 'skip' ? opts.openingBalances : later ? 'skip' : 'post';
    if (diffs.length && openingMode !== 'skip') {
      // a ledger for one fiscal year carries last year's closing balances: date them on that year's last day
      var dayBefore = U.addDays(firstDate, -1), fm0 = book.company.fiscalYearStartMonth || 1, fyS = U.fiscalYearStart(firstDate, fm0), lastOf = drafts.reduce(function (mx, d) { return d.date > mx ? d.date : mx; }, firstDate);
      var obDate = opts.openingBalanceDate || (drafts.length ? (U.fiscalYearStart(lastOf, fm0) === fyS ? U.addDays(fyS, -1) : dayBefore) : U.today());
      var obe = sysByCode.OBE ? vbById[sysByCode.OBE.id] : null;
      var jl = [], tot = 0;
      diffs.forEach(function (x) {
        if (x.accountId === (obe && obe.id)) return;
        var line = { accountId: x.accountId, debit: x.diff > 0 ? x.diff : 0, credit: x.diff < 0 ? -x.diff : 0, memo: 'QuickBooks balance not explained by imported transactions' };
        if (x.type === 'ar') line.contactId = contactFor('Opening balance (QuickBooks)', 'customer').id;
        if (x.type === 'ap') line.contactId = contactFor('Opening balance (QuickBooks)', 'vendor').id;
        jl.push(line); tot += x.diff;
      });
      if (tot && obe) jl.push({ accountId: obe.id, debit: tot < 0 ? -tot : 0, credit: tot > 0 ? tot : 0, memo: 'Offset to Opening Balance Equity' });
      if (jl.length >= 2) { obDraft = { type: 'journal', date: obDate, number: 'QB-OPEN', memo: 'Opening balances from QuickBooks (balances not explained by the imported transactions)', jlines: jl, importRef: 'QuickBooks opening balances' }; drafts.unshift(obDraft); kinds.journal = (kinds.journal || 0) + 1; }
    }

    /* ---- default accounts the import did not use: deactivate (zero balance, not system) ---- */
    var usedIds = {}; drafts.forEach(function (d) { (d._posts || []).forEach(function (p) { usedIds[p.accountId] = 1; }); });
    if (obDraft) obDraft.jlines.forEach(function (l) { usedIds[l.accountId] = 1; });
    if (closedDraft) closedDraft.jlines.forEach(function (l) { usedIds[l.accountId] = 1; });
    var deactivated = [];
    vbAccounts.forEach(function (a) {
      if (touched[a.id] || a.system || !a.active) return;
      if (book.accountBalance(a.id) === 0 && !usedIds[a.id]) { a.active = false; deactivated.push(a.name); }
    });
    var hiddenKept = [];
    vbAccounts.forEach(function (a) {
      if (!a.qbHidden) { delete a.qbHidden; return; }
      delete a.qbHidden;
      if (usedIds[a.id] || a.system) hiddenKept.push(a.name); else a.active = false;
    });
    if (hiddenKept.length) warn.push('Inactive QuickBooks accounts that have transactions were kept active so the history posts: ' + hiddenKept.join(', ') + '. Make them inactive after checking.');
    if (autoCreated.length) warn.push('Created ' + autoCreated.length + ' name' + (autoCreated.length === 1 ? '' : 's') + ' used in transactions but missing from the lists: ' + uniq(autoCreated).slice(0, 12).join(', ') + (uniq(autoCreated).length > 12 ? '…' : '') + '.');

    // posting order: documents first so every payment's applications exist when it is validated
    // (reports order by transaction date, so this does not change any report)
    var rank = function (d) { return d.importRef === 'QuickBooks opening balances' ? 0 : (d.type === 'payment' || d.type === 'billPayment' || d.type === 'customerRefund') ? 3 : (d.type === 'invoice' || d.type === 'bill' || d.type === 'creditMemo' || d.type === 'vendorCredit') ? 1 : 2; };
    drafts = drafts.map(function (d, i) { d._k = i; return d; }).sort(function (a, b) { return (rank(a) - rank(b)) || (a._k - b._k); });
    var bundleTx = drafts.map(function (d) { var o = {}; Object.keys(d).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = d[k]; }); return o; });
    var changedAccounts = vbAccounts.filter(function (a) { var o = book.accById[a.id]; return !o || U.stableStringify(o) !== U.stableStringify(a); });
    var preview = {
      files: model.files, source: model.source, kinds: kinds, transactions: drafts.length,
      accounts: { qb: qbAccounts.length, created: changedAccounts.filter(function (a) { return !book.accById[a.id]; }).length, updated: changedAccounts.filter(function (a) { return book.accById[a.id]; }).length, deactivated: deactivated },
      contacts: { customers: contacts.filter(function (c) { return c.kind === 'customer'; }).length, vendors: contacts.filter(function (c) { return c.kind === 'vendor'; }).length },
      items: items.length, classes: classes.length, applications: applied, openingDiffs: diffs, openingEntry: !!obDraft, openingMode: openingMode, balancesLater: later ? { listDate: model.listDate, lastDate: lastDate } : null,
      firstDate: drafts.filter(function (d) { return d !== obDraft; }).reduce(function (m, d) { return !m || d.date < m ? d.date : m; }, ''),
      lastDate: drafts.reduce(function (m, d) { return d.date > m ? d.date : m; }, '')
    };
    var record = { id: uid('imp'), at: now, from: model.qbo ? 'QuickBooks Online' : 'QuickBooks Desktop' + (model.company.product ? ' (' + model.company.product + ')' : ''), files: model.files.map(function (f) { return f.name; }),
      summary: 'Imported from QuickBooks: ' + drafts.length + ' transactions, ' + contacts.length + ' customers/vendors, ' + changedAccounts.length + ' accounts, ' + items.length + ' items',
      expected: Object.keys(expected).map(function (id) { return { accountId: id, balance: expected[id] }; }) };
    return {
      bundle: { accounts: changedAccounts, contacts: contacts, items: items, classes: classes, transactions: bundleTx, record: record,
        company: classes.length ? { useClasses: true } : {} },
      preview: preview, warnings: warn, errors: errs, expected: expected
    };
  };
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }

  /**
   * One QuickBooks transaction → one VaultBook draft. Uses the matching VaultBook document type when
   * the lines have that document's shape; anything else becomes a journal entry with the same postings.
   */
  Q.toDraft = function () { return toDraft.apply(null, arguments); }; // shared with Paste entries (1.48)
  function toDraft(t, rows, contactFor, classFor, itemByName, itemByDesc, daysFor, warn) {
    rows = rows.filter(function (r) { return r.amount !== 0 && r.acc; });
    if (!rows.length) return null;
    var typ = function (r) { return r.acc.type; };
    var ar = rows.filter(function (r) { return typ(r) === 'ar'; }), ap = rows.filter(function (r) { return typ(r) === 'ap'; });
    var cash = function (r) { return typ(r) === 'bank' || typ(r) === 'cc' || typ(r) === 'oca'; };
    var qt = String(t.qbType || '').toLowerCase();
    var base = { date: t.date, number: t.num, memo: t.memo };
    var posts = rows.map(function (r) { return { accountId: r.acc.id, amount: r.amount }; });
    var withPosts = function (d) { d._posts = posts; return d; };
    var lineOf = function (r, sign) {
      var l = { accountId: r.acc.id, description: r.memo, amount: sign * r.amount, contactId: '' };
      if (r.cls) l.classId = classFor(r.cls);
      var it = r.item && itemByName[String(r.item).toLowerCase()];
      if (!it && r.memo) { var cand = itemByDesc[r.memo.trim().toLowerCase()]; if (cand && cand.length) it = cand.find(function (x) { return x.incomeAccountId === r.acc.id; }) || (cand.length === 1 ? cand[0] : null); }
      if (it) l.itemId = it.id;
      if (r.qty && r.price) { l.qty = Math.abs(r.qty); l.rate = Math.abs(r.price); }
      return l;
    };
    var journal = function (why) {
      var jl = rows.map(function (r) {
        var l = { accountId: r.acc.id, debit: r.amount > 0 ? r.amount : 0, credit: r.amount < 0 ? -r.amount : 0, memo: r.memo, contactId: '' };
        var kind = typ(r) === 'ar' ? 'customer' : typ(r) === 'ap' ? 'vendor' : null;
        var nm = r.name || t.name;
        if (kind) l.contactId = nm ? contactFor(nm, kind).id : contactFor('Unassigned (QuickBooks)', kind).id;
        else if (nm) { var c = contactFor(nm, 'any'); if (c) l.contactId = c.id; }
        if (r.cls) l.classId = classFor(r.cls);
        return l;
      });
      var memo = [t.memo, t.adj ? '(adjusting entry)' : '', why && qt !== 'general journal' ? '[QuickBooks ' + t.qbType + ']' : ''].filter(Boolean).join(' ');
      return withPosts(Object.assign({}, base, { type: 'journal', memo: memo, jlines: jl }));
    };
    var others = function (exclude) { return rows.filter(function (r) { return exclude.indexOf(r) < 0; }); };
    var noArAp = function (list) { return !list.some(function (r) { return typ(r) === 'ar' || typ(r) === 'ap'; }); };
    var cust = function () { return contactFor((ar[0] && ar[0].name) || t.name, 'customer'); };
    var vend = function () { return contactFor((ap[0] && ap[0].name) || t.name, 'vendor'); };
    var dueOf = function (c) { // QuickBooks allows a due date before the document date; VaultBook does not, so the document date is used
      var early = t.dueDate && t.dueDate < t.date; if (early) (warn.earlyDue = warn.earlyDue || []).push((t.num || t.qbType) + ' ' + t.date);
      var d = c && c.terms !== undefined && c.terms !== '' ? +c.terms : null; return { terms: d === null ? '' : d, dueDate: early ? t.date : t.dueDate || (d === null ? '' : U.addDays(t.date, d)) }; };

    // A/R documents
    if (ar.length === 1 && !ap.length) {
      var rest = others(ar);
      if (/invoice|statement charge/.test(qt) && ar[0].amount > 0 && noArAp(rest)) { var c1 = cust(); return withPosts(Object.assign({}, base, { type: 'invoice', contactId: c1.id, lines: rest.map(function (r) { return lineOf(r, -1); }) }, dueOf(c1))); }
      if (/credit memo/.test(qt) && ar[0].amount < 0 && noArAp(rest)) return withPosts(Object.assign({}, base, { type: 'creditMemo', contactId: cust().id, lines: rest.map(function (r) { return lineOf(r, 1); }), applications: [] }));
      if (/payment/.test(qt) && ar[0].amount < 0 && rest.length === 1 && cash(rest[0]) && typ(rest[0]) !== 'cc' && rest[0].amount === -ar[0].amount)
        return withPosts(Object.assign({}, base, { type: 'payment', contactId: cust().id, accountId: rest[0].acc.id, amount: rest[0].amount, applications: [], _payNum: t.num }));
    }
    // A/P documents
    if (ap.length === 1 && !ar.length) {
      var restP = others(ap);
      if (/^bill$/.test(qt) && ap[0].amount < 0 && noArAp(restP)) { var v1 = vend(); return withPosts(Object.assign({}, base, { type: 'bill', contactId: v1.id, lines: restP.map(function (r) { return lineOf(r, 1); }) }, dueOf(v1))); }
      if (/^(credit|bill credit|vendor credit)$/.test(qt) && ap[0].amount > 0 && noArAp(restP)) return withPosts(Object.assign({}, base, { type: 'vendorCredit', contactId: vend().id, lines: restP.map(function (r) { return lineOf(r, -1); }), applications: [] }));
      if (/bill pmt/.test(qt) && ap[0].amount > 0 && restP.length === 1 && (typ(restP[0]) === 'bank' || typ(restP[0]) === 'cc') && restP[0].amount === -ap[0].amount)
        return withPosts(Object.assign({}, base, { type: 'billPayment', contactId: vend().id, accountId: restP[0].acc.id, amount: ap[0].amount, applications: [], _payNum: t.num }));
    }
    if (!ar.length && !ap.length) {
      var heads = rows.filter(cash);
      // sales receipt: one bank/undeposited debit, income credits
      if (/sales receipt|cash sale/.test(qt) && heads.length >= 1) {
        var h = heads.find(function (r) { return r.amount > 0; });
        if (h && heads.length === 1) return withPosts(Object.assign({}, base, { type: 'salesReceipt', contactId: t.name ? contactFor(t.name, 'customer').id : '', accountId: h.acc.id, lines: others([h]).map(function (r) { return lineOf(r, -1); }) }));
      }
      // transfer: exactly two cash-type accounts, equal and opposite
      // (money moved between two bank/card accounts by a check or transfer; deposits stay deposits)
      if (rows.length === 2 && /check|transfer|credit card payment/.test(qt) && rows.every(function (r) { return typ(r) === 'bank' || typ(r) === 'cc'; })) {
        var from = rows.find(function (r) { return r.amount < 0; }), to = rows.find(function (r) { return r.amount > 0; });
        if (from && to)
          return withPosts(Object.assign({}, base, { type: 'transfer', accountId: from.acc.id, toAccountId: to.acc.id, amount: to.amount, memo: [t.memo, t.name].filter(Boolean).join(' — ') }));
      }
      // money out of one bank/card account: check / expense / credit-card charge
      var outHeads = rows.filter(function (r) { return (typ(r) === 'bank' || typ(r) === 'cc') && r.amount < 0; });
      if (/check|credit card charge|expense|cc charge/.test(qt) && outHeads.length === 1) {
        var hd = outHeads[0], lines = others([hd]);
        if (lines.length && lines.reduce(function (s, r) { return s + r.amount; }, 0) > 0) {
          var payee = t.name ? contactFor(t.name, 'any') : null;
          var type = typ(hd) === 'cc' ? 'expense' : (/check/.test(qt) ? 'check' : 'expense');
          return withPosts(Object.assign({}, base, { type: type, accountId: hd.acc.id, contactId: payee ? payee.id : '', lines: lines.map(function (r) { return lineOf(r, 1); }) }));
        }
      }
      // money into one bank account: deposit
      var inHeads = rows.filter(function (r) { return typ(r) === 'bank' && r.amount > 0; });
      if (/deposit/.test(qt) && inHeads.length === 1) {
        var hdD = inHeads[0], linesD = others([hdD]);
        if (linesD.length && linesD.reduce(function (s, r) { return s + r.amount; }, 0) < 0) {
          return withPosts(Object.assign({}, base, { type: 'deposit', accountId: hdD.acc.id, contactId: '', lines: linesD.map(function (r) { var l = lineOf(r, -1); if (r.name) { var c = contactFor(r.name, 'any'); if (c) l.contactId = c.id; } return l; }) }));
        }
      }
      // credit-card credit
      var ccIn = rows.filter(function (r) { return typ(r) === 'cc' && r.amount > 0; });
      if (/credit card credit|cc credit/.test(qt) && ccIn.length === 1) {
        var linesC = others(ccIn);
        if (linesC.reduce(function (s, r) { return s + r.amount; }, 0) < 0) return withPosts(Object.assign({}, base, { type: 'ccCredit', accountId: ccIn[0].acc.id, contactId: t.name ? contactFor(t.name, 'any').id : '', lines: linesC.map(function (r) { return lineOf(r, -1); }) }));
      }
    }
    return journal(true);
  }

  /**
   * Apply customer payments to invoices and bill payments to bills, in date order:
   * 1) the document whose number appears in the payment's reference (e.g. "Inv 1007"),
   * 2) an open document of exactly the payment amount, 3) oldest open documents first.
   * Whatever is left stays as an unapplied credit — exactly how QuickBooks shows an unapplied payment.
   */
  function applyPayments(drafts, warn) {
    var open = {}, byContact = {}, byQb = {}, stats = { applied: 0, linked: 0, byNumber: 0, exact: 0, oldest: 0, unapplied: 0, unappliedAmount: 0 };
    drafts.forEach(function (d, i) { d._i = i; });
    // QuickBooks lets a payment be applied to an invoice dated later (payment recorded first), so every
    // document is known before any payment is applied; payments are still applied in date order.
    drafts.forEach(function (d) {
      if (d.type !== 'invoice' && d.type !== 'bill') return;
      d.id = d.id || U.uid('txn');
      open[d.id] = d.lines.reduce(function (s, l) { return s + l.amount; }, 0);
      (byContact[d.contactId] = byContact[d.contactId] || []).push(d);
      if (d._qb && d._qb.qbTxnId) byQb[d._qb.qbTxnId] = d;
    });
    drafts.forEach(function (d) {
      if (d.type !== 'payment' && d.type !== 'billPayment') return;
      var target = d.type === 'payment' ? 'invoice' : 'bill';
      var docs = (byContact[d.contactId] || []).filter(function (x) { return x.type === target && open[x.id] > 0; });
      var left = d.amount, apps = [];
      var take = function (x, how) { var a = Math.min(open[x.id], left); if (a <= 0) return; open[x.id] -= a; left -= a; apps.push({ txnId: x.id, amount: a }); stats[how]++; };
      // the connector's full export says exactly which documents QuickBooks applied the payment to
      if (d._qb && d._qb.links) {
        d._qb.links.forEach(function (l) { var x = byQb[l.txnId]; if (!x || x.type !== target || x.contactId !== d.contactId || left <= 0) return; var a = Math.min(open[x.id], left, l.amount); if (a <= 0) return; open[x.id] -= a; left -= a; apps.push({ txnId: x.id, amount: a }); stats.linked++; });
        d.applications = apps; if (left > 0) { stats.unapplied++; stats.unappliedAmount += left; } stats.applied += apps.length; delete d._payNum; return;
      }
      var nums = String(d._payNum || '').match(/\d[\w-]*/g) || [];
      nums.forEach(function (n) { docs.filter(function (x) { var xn = x._origNumber || x.number; return xn === n || xn.replace(/^\D+/, '') === n; }).forEach(function (x) { if (left > 0) take(x, 'byNumber'); }); });
      if (left > 0 && !apps.length) { var ex = docs.find(function (x) { return open[x.id] === left; }); if (ex) take(ex, 'exact'); }
      docs.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i; }).forEach(function (x) { if (left > 0 && open[x.id] > 0) take(x, 'oldest'); });
      d.applications = apps;
      if (left > 0) { stats.unapplied++; stats.unappliedAmount += left; }
      stats.applied += apps.length;
      delete d._payNum;
    });
    drafts.forEach(function (d) { delete d._i; });
    if (stats.unapplied) warn.push(stats.unapplied + ' payment' + (stats.unapplied === 1 ? '' : 's') + ' (' + U.fmt(stats.unappliedAmount, { symbol: true }) + ') had no open document left to apply to and remain as unapplied credits, as in QuickBooks.');
    if (stats.oldest) warn.push(stats.oldest + ' payment application' + (stats.oldest === 1 ? '' : 's') + ' could not be read from the export and were matched to the oldest open documents (QuickBooks’ automatic rule). Totals are exact; check open-invoice detail if it matters.');
    return stats;
  }

  /* ===================== after import: compare with QuickBooks ===================== */
  /** Compare VaultBook balances with QuickBooks' list balances. Returns rows + ok flag. */
  Q.compareBalances = function (book, expected) {
    var rows = [];
    Object.keys(expected || {}).forEach(function (id) {
      var a = book.accById[id]; if (!a) return;
      var have = book.rawBalance(id);
      var qb = expected[id];
      if (!S.isBS(a.type)) {
        // income/expense list amounts in QuickBooks exports are the all-time totals
        rows.push({ accountId: id, name: book.accountFullName(a), type: a.type, qb: qb, vb: have, ok: qb === have, pl: true });
      } else rows.push({ accountId: id, name: book.accountFullName(a), type: a.type, qb: qb, vb: have, ok: qb === have });
    });
    return { rows: rows, ok: rows.every(function (r) { return r.ok; }), mismatches: rows.filter(function (r) { return !r.ok; }).length };
  };

  /* ===================== QuickBooks Desktop reports printed to PDF (1.44) =====================
   * A PDF page arrives as rows of text runs with their position: [{ p: page, items: [{ x, w, s }] }] (left edge, width, text).
   * A General Ledger PDF is turned into the same grid a General Ledger CSV gives, so everything after this point is the CSV path.
   * With no chart of accounts file, the account list comes from the ledger itself and each account's type from where it sits
   * on the Balance Sheet and Profit and Loss PDFs. */
  var PDF_NUM = /^\(?-?[\d,]+\.\d\d\)?$/, PDF_DATE = /^\d\d\/\d\d\/\d{4}$/;
  var pdfLine = function (row) { return row.items.map(function (i) { return i.s; }).join(' ').replace(/\s+/g, ' ').trim(); };
  var pdfFurniture = function (row) { var t = row.items[0].s.trim(); return /^\d{1,2}:\d\d [AP]M$/.test(t) || /^\d\d\/\d\d\/\d\d$/.test(t) || /^(accrual|cash) basis$/i.test(t) || /^page \d+$/i.test(pdfLine(row)); };
  Q.pdfKind = function (rows) {
    var top = (rows || []).slice(0, 8).map(pdfLine).join('\n');
    if (/general ledger/i.test(top) && (rows || []).slice(0, 10).some(function (r) { var t = r.items.map(function (i) { return i.s.trim(); }); return t.indexOf('Type') >= 0 && t.indexOf('Date') >= 0 && t.indexOf('Debit') >= 0 && t.indexOf('Credit') >= 0; })) return 'gl';
    return /balance sheet/i.test(top) ? 'bs' : /profit\s*&?\s*(and\s*)?loss/i.test(top) ? 'pnl' : '';
  };
  /** The day a QuickBooks report was printed (top-left of its first page), as mm/dd/yy, or ''. */
  Q.pdfPrinted = function (rows) { var d = ''; (rows || []).slice(0, 4).forEach(function (r) { var t = r.items[0].s.trim(); if (!d && /^\d\d\/\d\d\/\d\d$/.test(t)) d = t; }); return d; };
  /** General Ledger PDF -> { csv, accounts: [{ full, level, parent, open, close, lines }], asOf, lines, cut }. */
  Q.pdfLedger = function (rows) {
    var hi = -1, k; for (k = 0; k < rows.length && hi < 0; k++) { var ht = rows[k].items.map(function (i) { return i.s.trim(); }); if (ht.indexOf('Type') >= 0 && ht.indexOf('Debit') >= 0 && ht.indexOf('Credit') >= 0) hi = k; }
    if (hi < 0) return null;
    var H = {}; rows[hi].items.forEach(function (i) { H[i.s.trim().toLowerCase()] = i.x + i.w / 2; });
    var isHeader = function (row) { var t = row.items.map(function (i) { return i.s.trim(); }); return t.indexOf('Type') >= 0 && t.indexOf('Debit') >= 0; };
    var MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var am = /as of ([a-z]+) (\d{1,2}), (\d{4})/i.exec(rows.slice(0, hi).map(pdfLine).join(' ')), asOf = am && MON.indexOf(am[1].toLowerCase()) >= 0 ? U.ymd(+am[3], MON.indexOf(am[1].toLowerCase()) + 1, +am[2]) : '';
    var numFrom = (H.debit || 0) - 45, isNum = function (i) { return PDF_NUM.test(i.s.trim()) && i.x + i.w / 2 > numFrom; };
    var body = rows.slice(hi + 1).filter(function (r) { return !pdfFurniture(r) && !isHeader(r); });
    // text columns are left-aligned: each one starts at the most common left edge between the previous heading and its own
    var TEXT = ['num', 'adj', 'name', 'memo', 'split', 'class'].filter(function (c) { return H[c] !== undefined; }), freq = {};
    body.forEach(function (r) { var d = r.items.filter(function (i) { return PDF_DATE.test(i.s.trim()); })[0]; if (!d) return; r.items.forEach(function (i) { if (i.x > d.x + 1 && !isNum(i)) { var x = Math.round(i.x); freq[x] = (freq[x] || 0) + 1; } }); });
    var starts = [], prevC = H.date || 0;
    TEXT.forEach(function (c) { var best = null; Object.keys(freq).forEach(function (x) { if (+x > prevC && +x <= H[c] && (best === null || freq[x] > freq[best])) best = x; }); if (best !== null) starts.push({ col: c, x: +best }); prevC = H[c]; });
    var colOf = function (x) { var c = ''; starts.forEach(function (s) { if (s.x <= x + 1.5) c = s.col; }); return c; };
    var numCol = function (i) { var c = i.x + i.w / 2, best = 'balance', d = 1e9; ['debit', 'credit', 'balance'].forEach(function (n) { if (H[n] !== undefined && Math.abs(c - H[n]) < d) { d = Math.abs(c - H[n]); best = n; } }); return best; };
    var grid = [['', 'Type', 'Date', 'Num', 'Adj', 'Name', 'Memo', 'Split', 'Class', 'Debit', 'Credit', 'Balance']], stack = [], accounts = [], lines = 0, cut = 0;
    var clean = function (t) { if (/\.\.\.$/.test(t.trim())) cut++; return t.replace(/\s*\.\.\.\s*$/, '').replace(/\s+/g, ' ').trim(); };
    body.forEach(function (r) {
      var d = r.items.filter(function (i) { return PDF_DATE.test(i.s.trim()); })[0], nums = r.items.filter(isNum), val = {};
      nums.forEach(function (i) { val[numCol(i)] = i.s.trim(); });
      if (d) {
        var cell = { num: [], adj: [], name: [], memo: [], split: [], class: [] }, type = r.items.filter(function (i) { return i.x < d.x - 1; }).map(function (i) { return i.s.trim(); }).join(' ');
        r.items.forEach(function (i) { if (i.x > d.x + 1 && !isNum(i)) { var c = colOf(i.x); if (c) cell[c].push(i.s.trim()); } });
        var j = function (c) { return clean(cell[c].join(' ')); };
        grid.push(['', type, d.s.trim(), j('num'), j('adj'), j('name'), j('memo'), j('split'), j('class'), val.debit || '', val.credit || '', val.balance || '']);
        lines++; if (stack.length) stack[stack.length - 1].acc.lines++;
        return;
      }
      var lab = r.items.filter(function (i) { return !isNum(i); }), label = lab.map(function (i) { return i.s.trim(); }).join(' ').replace(/\s+/g, ' ').trim(); if (!label) return;
      var x = lab[0].x, tot = /^total (.*)$/i.exec(label);
      if (label === 'TOTAL') { grid.push(['TOTAL', '', '', '', '', '', '', '', '', val.debit || '', val.credit || '', val.balance || '']); stack = []; return; }
      if (tot) {
        for (var q = stack.length - 1; q >= 0; q--) if (stack[q].label.toLowerCase() === tot[1].toLowerCase()) { stack[q].acc.close = cents(val.balance || nums.length && nums[nums.length - 1].s || '0'); stack.length = q; break; }
        grid.push([label, '', '', '', '', '', '', '', '', val.debit || '', val.credit || '', val.balance || '']); return;
      }
      while (stack.length && stack[stack.length - 1].x >= x - 1) stack.pop();
      var parent = stack.length ? stack[stack.length - 1] : null, other = parent && label.toLowerCase() === (parent.label + ' - Other').toLowerCase();
      var full = other ? parent.acc.full : (parent ? parent.acc.full + ':' : '') + label;
      var acc = { full: full, level: stack.length, parent: parent ? parent.acc.full : '', open: cents(val.balance || (nums.length ? nums[nums.length - 1].s : '0')), close: null, lines: 0, other: !!other };
      accounts.push(acc); stack.push({ label: label, x: x, acc: acc });
      grid.push([full, '', '', '', '', '', '', '', '', '', '', val.balance || '']);
    });
    var q2 = function (c) { c = String(c === undefined ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
    return { csv: grid.map(function (r) { return r.map(q2).join(','); }).join('\r\n'), accounts: accounts, asOf: asOf, lines: lines, cut: cut };
  };
  var PDF_SECTION = { 'checking/savings': 'BANK', 'accounts receivable': 'AR', 'other current assets': 'OCASSET', 'fixed assets': 'FIXASSET', 'other assets': 'OASSET', 'accounts payable': 'AP', 'credit cards': 'CCARD',
    'other current liabilities': 'OCLIAB', 'long term liabilities': 'LTLIAB', 'equity': 'EQUITY', 'income': 'INC', 'cost of goods sold': 'COGS', 'expense': 'EXP', 'other income': 'EXINC', 'other expense': 'EXEXP' };
  /** Balance Sheet / Profit and Loss PDF rows -> { lower-case account name: [types it appears under] }. */
  Q.pdfTypes = function (rows, into) {
    var types = into || {}, cur = '';
    (rows || []).forEach(function (r) {
      if (pdfFurniture(r)) return;
      var lab = r.items.filter(function (i) { return !PDF_NUM.test(i.s.trim()); }), label = lab.map(function (i) { return i.s.trim(); }).join(' ').replace(/\s+/g, ' ').trim(), has = lab.length < r.items.length, low = label.toLowerCase();
      if (!label) return;
      var tot = /^total (.*)$/i.exec(low);
      if (tot) { if (PDF_SECTION[tot[1]] === cur) cur = ''; return; }
      if (!has && PDF_SECTION[low]) { cur = PDF_SECTION[low]; return; }       // a section title carries no amount
      if (!cur || /^net (income|ordinary income|other income)$/.test(low) || low === 'gross profit') return;
      var name = low.replace(/ - other$/, ''); (types[name] = types[name] || []); if (types[name].indexOf(cur) < 0) types[name].push(cur);
    });
    return types;
  };
  /** Ledger accounts + statement types -> a chart of accounts in IIF form (balances as of the ledger date), with notes on any type that had to be inferred. */
  Q.pdfChart = function (led, types) {
    var SEQ = ['BANK', 'AR', 'OCASSET', 'FIXASSET', 'OASSET', 'AP', 'CCARD', 'OCLIAB', 'LTLIAB', 'EQUITY', 'INC', 'COGS', 'EXP', 'EXINC', 'EXEXP'], byFull = {}, list = [], notes = [];
    led.accounts.forEach(function (a) {
      if (a.other) { var p = byFull[a.full]; if (p) { p.ownOpen = a.open; p.ownClose = a.close === null ? a.open : a.close; p.hasOther = true; } return; }
      var e = { full: a.full, level: a.level, parent: a.parent, open: a.open, close: a.close === null ? a.open : a.close, kids: [], lines: a.lines }; byFull[a.full] = e; list.push(e);
      if (a.parent && byFull[a.parent]) byFull[a.parent].kids.push(e);
    });
    list.forEach(function (e) {   // a parent's printed balance includes its sub-accounts: its own part is what is left
      if (e.hasOther) { e.open = e.ownOpen; e.close = e.ownClose; }
      else if (e.kids.length) { e.open -= U.sum(e.kids, function (k) { return k.open; }); e.close -= U.sum(e.kids, function (k) { return k.close; }); }
    });
    var leaf = function (f) { return f.split(':').pop().toLowerCase(); };
    list.forEach(function (e) { var t = types[leaf(e.full)]; e.type = t && t.length === 1 ? t[0] : ''; e.maybe = t || []; });
    list.forEach(function (e) { if (!e.type && e.parent && byFull[e.parent] && byFull[e.parent].type) e.type = byFull[e.parent].type; });
    var tops = list.filter(function (e) { return !e.level; });
    tops.forEach(function (e, i) {
      if (e.type) return;
      var lo = 0, hi = SEQ.length - 1, a, b;
      for (a = i - 1; a >= 0; a--) if (tops[a].type) { lo = SEQ.indexOf(tops[a].type); break; }
      for (b = i + 1; b < tops.length; b++) if (tops[b].type && !tops[b].guessed) { hi = SEQ.indexOf(tops[b].type); break; }
      var inR = function (t) { var x = SEQ.indexOf(t); return x >= lo && x <= hi; }, n = leaf(e.full), pick = e.maybe.filter(inR)[0];
      var hint = /ask my accountant/.test(n) ? 'EXEXP' : /accu|deprec|amortiz/.test(n) ? 'FIXASSET' : /receivable/.test(n) ? 'AR' : /accounts payable/.test(n) ? 'AP' : /credit card|amex|visa|mastercard/.test(n) ? 'CCARD' : /loan|payable|liabilit/.test(n) ? 'OCLIAB' : '';
      e.type = pick || (lo === hi ? SEQ[lo] : hint && inR(hint) ? hint : lo <= hi ? SEQ[lo] : 'OCASSET'); e.guessed = true;
      notes.push(e.full + ' as ' + S.TYPE[ACC_TYPE[e.type]].label);
    });
    list.forEach(function (e) { if (!e.type) e.type = byFull[e.parent] ? byFull[e.parent].type : 'OCASSET'; });
    var T = '\t', out = ['!HDR' + T + 'PROD' + T + 'VER' + T + 'REL' + T + 'IIFVER' + T + 'DATE', 'HDR' + T + 'QuickBooks General Ledger (PDF)' + T + T + T + '1' + T + (led.asOf || ''), '!ACCNT' + T + 'NAME' + T + 'ACCNTTYPE' + T + 'OBAMOUNT'];
    list.forEach(function (e) { out.push('ACCNT' + T + e.full + T + e.type + T + (e.close / 100).toFixed(2)); });
    return { iif: out.join('\r\n'), accounts: list, notes: notes };
  };
  /** PDFs of one company -> the extra input files Q.read understands, a label per PDF and notes. haveChart: a real chart of accounts file was supplied. */
  Q.pdfInputs = function (pdfs, haveChart) {
    var res = { files: [], labels: {}, notes: [] }, types = {}, led = null, ledName = '';
    (pdfs || []).forEach(function (f) { var k = Q.pdfKind(f.rows); if (k === 'bs' || k === 'pnl') Q.pdfTypes(f.rows, types); else if (k === 'gl' && !led) { led = Q.pdfLedger(f.rows); ledName = f.name; } });
    if (!led || !led.lines) return res;
    res.labels[ledName] = 'General Ledger (PDF) — ' + led.lines.toLocaleString('en-US') + ' lines' + (led.asOf ? ', as of ' + U.fmtDate(led.asOf) : '');
    res.files.push({ name: ledName.replace(/\.pdf$/i, '') + ' (ledger).csv', text: led.csv });
    if (led.cut) res.notes.push(ledName + ': the printed report cuts long text short; ' + led.cut.toLocaleString('en-US') + ' names, memos or numbers end where the PDF ends them. Amounts, dates and accounts are complete. A General Ledger exported as CSV keeps the full text.');
    if (!haveChart) {
      var ch = Q.pdfChart(led, types); res.files.unshift({ name: ledName.replace(/\.pdf$/i, '') + ' (accounts).iif', text: ch.iif });
      if (!Object.keys(types).length) res.notes.push('No Balance Sheet or Profit and Loss PDF was added, so account types could not be read and every account was taken as ' + S.TYPE[ACC_TYPE.BANK].label + ' or similar by position. Add both statements for the ledger date.');
      else if (ch.notes.length) res.notes.push(ch.notes.length + ' account' + (ch.notes.length === 1 ? ' is' : 's are') + ' on neither statement (zero balance), so the type comes from the account\'s place in the ledger: ' + ch.notes.slice(0, 12).join('; ') + (ch.notes.length > 12 ? ' and ' + (ch.notes.length - 12) + ' more' : '') + '. Change it in the Chart of Accounts if needed.');
    }
    return res;
  };

  /** Totals by account from the text of a QuickBooks Profit & Loss: { kind, all, from, to, byId }. Sub-accounts are read through their parent
   *  heading, and "Parent - Other" is the parent itself. accByQB maps a full lower-case QuickBooks name to the account. */
  Q.statementTotals = function (text, accByQB) {
    var t = String(text || ''), kind = /balance sheet/i.test(t) ? 'bs' : /profit\s*&?\s*(and\s*)?loss/i.test(t) ? 'pnl' : ''; if (kind !== 'pnl') return null;
    var MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var pm = /([A-Z][a-z]+) (\d{4}) through ([A-Z][a-z]+) (\d{4})/.exec(t.replace(/[ \t]+/g, ' ')), res = { kind: kind, all: /all transactions/i.test(t), from: '', to: '', byId: {} };
    if (pm && MON.indexOf(pm[1].toLowerCase()) >= 0 && MON.indexOf(pm[3].toLowerCase()) >= 0) { res.from = U.ymd(+pm[2], MON.indexOf(pm[1].toLowerCase()) + 1, 1); res.to = U.monthEnd(U.ymd(+pm[4], MON.indexOf(pm[3].toLowerCase()) + 1, 1)); }
    var stack = [], find = function (parts) { return accByQB[parts.join(':').toLowerCase().replace(/\s+/g, ' ')]; }, byKey = {};
    Object.keys(accByQB).forEach(function (k) { byKey[k.replace(/\s+/g, ' ')] = accByQB[k]; }); accByQB = byKey;
    t.split(/\n/).forEach(function (line) {
      var m = /^\s*(.*?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s*$/.exec(line), label = (m ? m[1] : line).replace(/\s+/g, ' ').trim(); if (!label) return;
      var tot = /^total (.*)$/i.exec(label);
      if (tot) { if (stack.length && stack[stack.length - 1].toLowerCase() === tot[1].toLowerCase()) stack.pop(); return; }
      // a line with no amount is a parent heading only when that account really has sub-accounts ("Other Income" is also a section title)
      if (!m) { var pk = stack.concat([label]).join(':').toLowerCase() + ':'; if (find(stack.concat([label])) && Object.keys(accByQB).some(function (k) { return k.indexOf(pk) === 0; })) stack.push(label); return; }
      var other = / - other$/i.test(label), a = other ? find(stack) : find(stack.concat([label]));
      if (a) res.byId[a.id] = (res.byId[a.id] || 0) + cents(m[2]);
    });
    return res;
  };

  /**
   * Check the text of a QuickBooks Profit & Loss or Balance Sheet (PDF text, one report line per entry).
   * Matches "Account name   1,234.56" lines to VaultBook accounts by name and compares the amounts:
   * P&L lines against the period total, Balance Sheet lines against the balance on the report date.
   * Returns { kind, date, matched[], mismatched[], unmatched[] }.
   */
  Q.verifyText = function (book, text, opts) {
    opts = opts || {};
    var t = String(text || ''), kind = /balance sheet/i.test(t) ? 'bs' : /profit\s*&?\s*(and\s*)?loss/i.test(t) ? 'pnl' : '';
    var dm = /\b([A-Z][a-z]{2}) (\d{1,2}), (\d{2,4})\b/.exec(t), date = '';
    if (dm) { var mon = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(dm[1]) / 3 + 1; var y = +dm[3]; if (y < 100) y += 2000; if (mon > 0) date = y + '-' + pad(mon) + '-' + pad(dm[2]); }
    var all = /all transactions/i.test(t);
    var res = { kind: kind, date: date, matched: [], mismatched: [], unmatched: [] };
    if (!kind) return res;
    var byName = {}; book.accounts.forEach(function (a) { (byName[a.name.toLowerCase()] = byName[a.name.toLowerCase()] || []).push(a); });
    t.split(/\n/).forEach(function (line) {
      var m = /^\s*(.*?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s*$/.exec(line); if (!m) return;
      var label = m[1].trim(), amt = cents(m[2]);
      if (/^(total|net|gross|liabilities|equity|assets|income|expense)\b/i.test(label) && !byName[label.toLowerCase()]) return;
      var accs = byName[label.toLowerCase()]; if (!accs || accs.length !== 1) { if (!/^total /i.test(label)) res.unmatched.push({ label: label, amount: amt }); return; }
      var a = accs[0], sign = S.TYPE[a.type].normal === 'D' ? 1 : -1;
      // "All Transactions" reports include every dated entry (QuickBooks still prints a column date)
      var to = all ? undefined : (date || undefined);
      var bal = kind === 'pnl' && !all && opts.from ? book.rawBalance(a.id, to, opts.from) : book.rawBalance(a.id, to);
      // QuickBooks prints Retained Earnings with every earlier year's result already inside it; VaultBook works those years out from the income and expense accounts
      if (kind === 'bs' && a.system === 'RE' && date) { var fy = U.addDays(U.fiscalYearStart(date, book.company.fiscalYearStartMonth || 1), -1); book.accounts.forEach(function (x) { if (!S.isBS(x.type)) bal += book.rawBalance(x.id, fy); }); }
      var vb = sign * bal;
      (vb === amt ? res.matched : res.mismatched).push({ label: label, accountId: a.id, qb: amt, vb: vb });
    });
    return res;
  };
})(typeof window !== 'undefined' ? window : globalThis);
