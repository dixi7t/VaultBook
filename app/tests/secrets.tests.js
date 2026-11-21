/* VaultBook — connection secrets tests (1.58.0). Loaded by tests/run-node.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, T = OB.tests, X = OB.secrets;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  var URL1 = 'https://USER123:PASS456@beta-bridge.simplefin.org/simplefin';

  test('SEC-01 a secret is stored encrypted, read back exactly, and listing never returns the value', function () {
    var mem = X._useStore(X._memoryStore());
    return X.put('simplefin:co1', URL1, { companyId: 'co1', kind: 'simplefin', label: 'SimpleFIN Bridge' }).then(function (rec) {
      eq(rec.value, undefined, 'put does not hand the value back'); eq(rec.label, 'SimpleFIN Bridge');
      var raw = mem._raw.get('simplefin:co1'), bytes = Buffer.from(raw.data).toString('latin1');
      ok(bytes.indexOf('PASS456') < 0 && bytes.indexOf('simplefin.org') < 0, 'no plain text in the stored bytes');
      ok(!('value' in raw), 'no plain value field stored');
      return X.list('co1');
    }).then(function (list) {
      eq(list.length, 1); ok(JSON.stringify(list).indexOf('PASS456') < 0, 'list has no secret');
      return X.get('simplefin:co1');
    }).then(function (v) { eq(v, URL1, 'decrypts to the same value'); return X.get('missing'); })
      .then(function (v) { eq(v, null, 'unknown id gives null'); });
  });
  test('SEC-02 the device key cannot be exported, and changed bytes or a moved record fail to decrypt', function () {
    var mem = X._useStore(X._memoryStore());
    return X.put('a', 'secret-a', { companyId: 'co1', kind: 'x' }).then(function () {
      return mem.getKey();
    }).then(function (k) {
      eq(k.extractable, false, 'device key is not extractable');
      return root.crypto.subtle.exportKey('raw', k).then(function () { throw new Error('key was exported'); }, function () { /* expected */ });
    }).then(function () {
      var raw = mem._raw.get('a'); raw.data = new Uint8Array(raw.data); raw.data[0] ^= 1;   // tamper
      return X.get('a').then(function () { throw new Error('tampered bytes decrypted'); }, function () { /* expected */ });
    }).then(function () {
      return X.put('b', 'secret-b', { companyId: 'co1', kind: 'x' });
    }).then(function () {
      var raw = mem._raw.get('b'); raw.companyId = 'co2';                                       // moved to another company
      return X.get('b').then(function () { throw new Error('moved record decrypted'); }, function () { /* expected */ });
    });
  });
  test('SEC-03 remove and removeCompany revoke secrets; other companies keep theirs', function () {
    X._useStore(X._memoryStore());
    return Promise.all([X.put('s1', 'v1', { companyId: 'co1' }), X.put('s2', 'v2', { companyId: 'co1' }), X.put('s3', 'v3', { companyId: 'co2' })])
      .then(function () { return X.remove('s1'); }).then(function () { return X.list('co1'); })
      .then(function (l) { eq(l.length, 1, 'one left after remove'); return X.removeCompany('co1'); })
      .then(function () { return X.list(); })
      .then(function (l) { eq(l.length, 1, 'only the other company remains'); eq(l[0].id, 's3'); });
  });
  test('SEC-04 a company backup never contains a stored secret', function () {
    X._useStore(X._memoryStore());
    return Promise.resolve(OB.Book.create(new OB.MemoryAdapter(), { name: 'Secret Co' })).then(function (b) {
      return X.put('simplefin:' + b.company.id, URL1, { companyId: b.company.id, kind: 'simplefin' }).then(function () {
        var text = JSON.stringify(OB.backup.create(b));
        ok(text.length > 1000, 'the backup has real content'); ok(text.indexOf('PASS456') < 0 && text.indexOf('beta-bridge') < 0, 'backup has no secret');
      });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
