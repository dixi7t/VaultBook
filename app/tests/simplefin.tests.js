/* VaultBook — SimpleFIN bank sync tests (1.59.0), with SimpleFIN's public demo data and a fake network. */
(function (root) {
  'use strict';
  var OB = root.OB, T = OB.tests, SF = OB.simplefin;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  var DEMO = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'simplefin-demo.json'), 'utf8'));
  var ACCESS = 'https://demo%2Buser:p%40ss@beta-bridge.simplefin.org/simplefin';
  var TOKEN = Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/DEMO-TEST').toString('base64');
  function res(status, body) { return Promise.resolve({ status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); }, json: function () { return Promise.resolve(body); } }); }

  test('SF-01 setup token: SimpleFIN Bridge https claim URLs only; claim returns the Access URL once', function () {
    eq(SF.claimUrl(' ' + TOKEN + '\n'), 'https://beta-bridge.simplefin.org/simplefin/claim/DEMO-TEST', 'whitespace ignored');
    [Buffer.from('https://evil.example.com/simplefin/claim/x').toString('base64'), Buffer.from('http://beta-bridge.simplefin.org/simplefin/claim/x').toString('base64'), 'not a token!!', ''].forEach(function (t) {
      var threw = false; try { SF.claimUrl(t); } catch (e) { threw = true; } ok(threw, 'refused: ' + t);
    });
    var calls = [];
    return SF.claim(TOKEN, function (u, o) { calls.push(o.method + ' ' + u); return res(200, ACCESS + '\n'); }).then(function (access) {
      eq(access, ACCESS); eq(calls[0], 'POST https://beta-bridge.simplefin.org/simplefin/claim/DEMO-TEST');
      return SF.claim(TOKEN, function () { return res(403, 'Forbidden'); }).then(function () { throw new Error('403 accepted'); }, function (e) { ok(/already used/.test(e.message), e.message); });
    });
  });
  test('SF-02 Access URL: credentials move to an Authorization header and never into the request URL', function () {
    var a = SF.parseAccess(ACCESS);
    eq(a.base, 'https://beta-bridge.simplefin.org/simplefin'); eq(a.auth, 'Basic ' + Buffer.from('demo+user:p@ss').toString('base64'));
    eq(SF.parseAccess('https://u:p@evil.example.com/simplefin'), null, 'other hosts refused'); eq(SF.parseAccess('https://beta-bridge.simplefin.org/simplefin'), null, 'no credentials');
    var seen;
    return SF.accounts(ACCESS, { start: 1000, end: 2000 }, function (u, o) { seen = { u: u, h: o.headers.Authorization }; return res(200, DEMO); }).then(function (r) {
      ok(seen.u.indexOf('@') < 0 && seen.u.indexOf('p%40ss') < 0, 'no credentials in URL'); ok(/start-date=1000/.test(seen.u) && /end-date=2000/.test(seen.u) && /version=2/.test(seen.u), seen.u);
      eq(seen.h, a.auth); eq(r.accounts.length, 3); eq(r.accounts[0].org, 'SimpleFIN Bridge', 'bank name from connections');
      eq(r.messages.length, 0, 'the 45-day advice is not shown as a problem');
    });
  });
  test('SF-03 rows: signed cents, bank text first, pending and repeated ids left out; windows of 45 days', function () {
    eq(SF.cents('-120.00'), -12000); eq(SF.cents('4.5'), 450); eq(SF.cents('1,'), 100); eq(SF.cents(null), 0);
    var chk = DEMO.accounts[1], rows = SF.rows(chk.transactions.concat([chk.transactions[0]]));
    eq(rows.length, 6, 'pending and the repeated id dropped');
    eq(rows[0].amount, SF.cents(chk.transactions[0].amount)); ok(/^\d{4}-\d\d-\d\d$/.test(rows[0].date));
    eq(rows[0].description, chk.transactions[0].memo, 'raw bank text (memo) is the description');
    eq(SF.windows(0, 90 * 86400).length, 2); eq(SF.windows(0, 10 * 86400).length, 1); eq(SF.windows(0, 46 * 86400).length, 2);
    eq(SF.clean('<b>Bank</b>\u0007  needs\nlogin'), 'Bank needs login', 'messages are plain text');
  });
  test('SF-04 sync into the bank feed: lines go to For review; a second sync with overlap adds nothing', function () {
    var b, chkId, n = 0;
    var net = function () { n++; return res(200, DEMO); };
    return Promise.resolve(OB.Book.create(new OB.MemoryAdapter(), { name: 'Sync Co' })).then(function (book) {
      b = book; chkId = b.accounts.find(function (a) { return a.type === 'bank'; }).id;
      return SF.fetchRange(ACCESS, 0, 60 * 86400, net);
    }).then(function (r) {
      eq(n, 2, 'two 45-day requests for 60 days'); eq(r.requests, 2);
      var demoChk = r.accounts.find(function (a) { return /Checking/.test(a.name); });
      eq(demoChk.transactions.length, 7, 'same ids from both windows merged once');
      return b.importBankLines(chkId, SF.rows(demoChk.transactions), { fileName: 'SimpleFIN sync', source: 'simplefin' }).then(function (x) {
        eq(x.added, 6, 'six posted lines'); eq(b.bankLinesFor(chkId, 'review').length, 6);
        return b.importBankLines(chkId, SF.rows(demoChk.transactions), { fileName: 'SimpleFIN sync', source: 'simplefin' });
      });
    }).then(function (x) { eq(x.added, 0, 'nothing new on the second sync'); eq(x.duplicates, 6); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
