/* VaultBook — optional bank sync through SimpleFIN Bridge (1.59.0). Off until the person connects it.
 *
 * How it works (https://www.simplefin.org/protocol.html): the person pays SimpleFIN Bridge, links their banks there and
 * makes a one-time "setup token" for VaultBook. The token is a Base64 claim URL; VaultBook POSTs to it once and gets an
 * Access URL (credentials inside), which is kept encrypted by OB.secrets on this device. Syncing GETs /accounts straight
 * from the browser (SimpleFIN allows this origin); no VaultBook server is involved. Lines go to the bank feed's For review
 * list through Book.importBankLines, with the same duplicate check as a file import.
 *
 * Engine only (no screens); fetch is injectable so tests run without the network.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var HOSTS = ['beta-bridge.simplefin.org'];       // also listed in the page's connect-src policy
  var WINDOW_DAYS = 45;                             // SimpleFIN's recommended range per request
  var DAY = 86400;

  function err(msg) { var e = new Error(msg); e.name = 'SimpleFINError'; return e; }
  function b64decode(s) {
    if (typeof root.atob === 'function') return root.atob(s);
    return Buffer.from(s, 'base64').toString('binary');
  }
  function b64encode(s) {
    if (typeof root.btoa === 'function') return root.btoa(s);
    return Buffer.from(s, 'binary').toString('base64');
  }
  function allowedUrl(u) {
    var url; try { url = new URL(u); } catch (e) { return null; }
    if (url.protocol !== 'https:' || HOSTS.indexOf(url.hostname) < 0) return null;
    return url;
  }
  /** Text from SimpleFIN shown to the person: plain text only, short. */
  function clean(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240); }

  var SF = OB.simplefin = {
    HOSTS: HOSTS,
    WINDOW_DAYS: WINDOW_DAYS,
    clean: clean,

    /** Setup token -> claim URL. Throws a readable error for anything that is not a SimpleFIN Bridge token. */
    claimUrl: function (token) {
      var t = String(token || '').replace(/\s+/g, '');
      if (!t) throw err('Paste the setup token from SimpleFIN Bridge.');
      var decoded;
      try { decoded = b64decode(t); } catch (e) { throw err('That is not a SimpleFIN setup token (it should be a long block of letters and numbers).'); }
      var url = allowedUrl(decoded);
      if (!url || !/\/claim\//.test(url.pathname)) throw err('That token does not point to SimpleFIN Bridge (' + HOSTS.join(', ') + '). VaultBook only connects there.');
      return url.href;
    },

    /** One-time claim: setup token -> Access URL. A token can be claimed only once. */
    claim: function (token, fetchFn) {
      var f = fetchFn || root.fetch.bind(root), u;
      try { u = SF.claimUrl(token); } catch (e) { return Promise.reject(e); }
      return f(u, { method: 'POST' }).then(function (res) {
        if (res.status === 403) throw err('SimpleFIN refused this token: it was already used or is not valid. Make a new setup token in SimpleFIN Bridge. If you did not use this token yourself, someone else may have it: revoke it there.');
        if (!res.ok) throw err('SimpleFIN did not accept the token (error ' + res.status + '). Try again in a few minutes.');
        return res.text();
      }).then(function (text) {
        var access = String(text || '').trim();
        if (!SF.parseAccess(access)) throw err('SimpleFIN answered with something VaultBook did not expect. Make a new setup token and try again.');
        return access;
      });
    },

    /** Access URL -> { base, auth } (base without credentials; auth for the Authorization header), or null. */
    parseAccess: function (access) {
      var url = allowedUrl(access);
      if (!url || !url.username) return null;
      var user = decodeURIComponent(url.username), pass = decodeURIComponent(url.password);
      url.username = ''; url.password = '';
      return { base: url.href.replace(/\/$/, ''), auth: 'Basic ' + b64encode(user + ':' + pass) };
    },

    /** Day windows of at most WINDOW_DAYS covering [startSec, endSec], oldest first. */
    windows: function (startSec, endSec) {
      var out = [], s = startSec;
      while (s < endSec) { var e = Math.min(endSec, s + WINDOW_DAYS * DAY); out.push([s, e]); s = e; }
      return out.length ? out : [[startSec, endSec]];
    },

    /** GET /accounts for one window. opts: { start, end (unix seconds), balancesOnly } */
    accounts: function (access, opts, fetchFn) {
      var f = fetchFn || root.fetch.bind(root), a = SF.parseAccess(access);
      if (!a) return Promise.reject(err('The saved SimpleFIN connection is not valid. Disconnect and connect again.'));
      opts = opts || {};
      var q = ['version=2'];
      if (opts.balancesOnly) q.push('balances-only=1');
      if (opts.start) q.push('start-date=' + Math.floor(opts.start));
      if (opts.end) q.push('end-date=' + Math.floor(opts.end));
      return f(a.base + '/accounts?' + q.join('&'), { headers: { Authorization: a.auth } }).then(function (res) {
        if (res.status === 403 || res.status === 401) throw err('SimpleFIN no longer accepts this connection (it may have been revoked). Disconnect and connect again with a new setup token.');
        if (res.status === 402) throw err('SimpleFIN says the subscription needs attention. Check your account at SimpleFIN Bridge.');
        if (!res.ok) throw err('SimpleFIN could not be reached (error ' + res.status + '). Try again later.');
        return res.json();
      }).then(function (d) {
        var conns = {}; (d.connections || []).forEach(function (c) { conns[c.conn_id] = c; });
        var msgs = (d.errlist || []).map(function (x) { return clean(x && (x.msg || x.message || x)); })
          .concat((d.errors || []).map(clean)).filter(function (m) { return m && !/recommended range/i.test(m); });
        var accounts = (d.accounts || []).map(function (x) {
          var c = conns[x.conn_id] || {};
          return { id: String(x.id), name: clean(x.name), org: clean(c.org_name || (x.org && x.org.name) || c.name || ''), currency: x.currency || 'USD',
            balance: SF.cents(x.balance), balanceDate: x['balance-date'] || 0, transactions: x.transactions || [] };
        });
        return { accounts: accounts, messages: msgs };
      });
    },

    /** "-120.00" -> -12000 */
    cents: function (v) {
      var s = String(v == null ? '0' : v).trim(), neg = s.charAt(0) === '-';
      s = s.replace(/^[-+]/, '');
      var p = s.split('.'), c = parseInt(p[0] || '0', 10) * 100 + parseInt(((p[1] || '') + '00').slice(0, 2), 10);
      if (isNaN(c)) return 0;
      return neg ? -c : c;
    },
    /** Unix seconds -> yyyy-mm-dd in the device's time zone. */
    day: function (sec) {
      var d = new Date(sec * 1000);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    /** SimpleFIN transactions -> bank feed rows (positive = money into the account), pending ones left out. */
    rows: function (transactions) {
      var seen = {};
      return (transactions || []).filter(function (t) {
        if (!t || t.pending || !t.posted) return false;
        if (seen[t.id]) return false; seen[t.id] = 1; return true;
      }).map(function (t) {
        var text = clean(t.memo) || clean(t.description) || clean(t.payee) || '(no description)';
        return { date: SF.day(t.posted), description: text, amount: SF.cents(t.amount), checkNo: '', balance: null };
      }).filter(function (r) { return r.amount; });
    },

    /**
     * Fetch every window from startSec to now, merge transactions per SimpleFIN account (by transaction id).
     * Resolves { accounts: [{id, name, org, balance, transactions}], messages, requests }.
     */
    fetchRange: function (access, startSec, endSec, fetchFn) {
      var wins = SF.windows(startSec, endSec), byId = {}, order = [], messages = [];
      return wins.reduce(function (p, w) {
        return p.then(function () { return SF.accounts(access, { start: w[0], end: w[1] }, fetchFn); }).then(function (r) {
          r.messages.forEach(function (m) { if (messages.indexOf(m) < 0) messages.push(m); });
          r.accounts.forEach(function (a) {
            if (!byId[a.id]) { byId[a.id] = { id: a.id, name: a.name, org: a.org, balance: a.balance, transactions: [] }; order.push(a.id); }
            var have = {}; byId[a.id].transactions.forEach(function (t) { have[t.id] = 1; });
            a.transactions.forEach(function (t) { if (!have[t.id]) byId[a.id].transactions.push(t); });
            byId[a.id].balance = a.balance;
          });
        });
      }, Promise.resolve()).then(function () {
        return { accounts: order.map(function (id) { return byId[id]; }), messages: messages, requests: wins.length };
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
