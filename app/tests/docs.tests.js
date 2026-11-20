/* VaultBook — Doc Center (1.49.0): inbox, reading documents, matching, missing documents, clean up, CPA package.
   Synthetic names only. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, D = OB.docs, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Expected true'); }
  function withBook(fn) { return function () { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Docs Co' }).then(fn); }; }
  var url = function (s) { return 'data:application/pdf;base64,' + (typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64')); };
  function setup(b) {
    var chk = b.accounts.find(function (a) { return a.name === 'Checking'; }), exp = b.accounts.find(function (a) { return a.type === 'expense'; }), v = {};
    return Promise.all([b.saveContact({ name: 'Office Mart', kind: 'vendor' }), b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' })]).then(function (cs) {
      v.om = cs[0]; v.ps = cs[1];
      var ck = function (date, who, amt, num) { return b.saveTransaction({ type: 'check', date: date, number: num || '', accountId: chk.id, contactId: who.id, lines: [{ accountId: exp.id, amount: amt }] }); };
      return Promise.all([ck('2024-03-05', v.om, '45.10'), ck('2024-03-01', v.ps, '1500.00', '1001'), ck('2024-03-20', v.om, '12.00'), ck('2024-04-01', v.ps, '1500.00', '1002')]);
    }).then(function (ts) { v.t = ts; v.chk = chk; return v; });
  }

  test('DC-01 file names give date, amount and vendor in common layouts', withBook(function (b) {
    return setup(b).then(function () {
      var r = function (n) { var x = D.readName(b, n); return [x.date, x.amount, x.vendor ? x.vendor.name : '']; };
      eq(r('Office Mart 45.10 03-05-2024.pdf'), ['2024-03-05', 4510, 'Office Mart']);
      eq(r('2024-03-01_pine-street-llc_$1,500.00.jpg'), ['2024-03-01', 150000, 'Pine Street LLC']);
      eq(r('receipt 3.5.24 office mart.png'), ['2024-03-05', 0, 'Office Mart']);
      eq(r('IMG_4412.JPG'), ['', 0, '']);
    });
  }));
  test('DC-02 PDF text gives the total, the document date and the vendor', withBook(function (b) {
    return setup(b).then(function () {
      var x = D.readText(b, 'OFFICE MART #221\nInvoice Date: 03/05/2024\nPaper  10.00\nSubtotal  41.69\nTax  3.41\nTOTAL  $45.10\nThank you');
      eq([x.date, x.amount, x.vendor && x.vendor.name], ['2024-03-05', 4510, 'Office Mart']);
      eq(D.readText(b, 'Amount Due: 1,500.00\nDue 04/01/2024\nStatement date 03/01/2024').amount, 150000);
    });
  }));
  test('DC-03 inbox files wait unattached, then match and attach to the right transaction', withBook(function (b) {
    var v;
    return setup(b).then(function (x) { v = x; return b.addAttachment({ inbox: true, name: 'Office Mart 45.10 03-05-2024.pdf', dataUrl: url('receipt-1') }); }).then(function (a) {
      eq(a.ownerId, ''); eq(D.inbox(b).length, 1); ok(a.hash, 'hashed');
      var s = D.suggest(b, a);
      eq(s[0].t.id, v.t[0].id); ok(s[0].sure, 'sure match');
      ok(s.every(function (m) { return m.t.id !== v.t[2].id || m.score < s[0].score; }));
      return b.linkAttachment(a.id, v.t[0].id);
    }).then(function () { eq(D.inbox(b).length, 0); eq(b.attachmentsFor(v.t[0].id).length, 1); ok(b.audit.some(function (e) { return /Attached Office Mart/.test(e.summary || e.text || JSON.stringify(e)); })); });
  }));
  test('DC-04 two rent checks of the same amount: the date decides, and nothing is sure without it', withBook(function (b) {
    var v;
    return setup(b).then(function (x) { v = x; return b.addAttachment({ inbox: true, name: 'Pine Street LLC 1500.00.pdf', dataUrl: url('rent') }); }).then(function (a) {
      var s = D.suggest(b, a); eq(s.length, 2); ok(!s[0].sure, 'not sure without a date');
      return b.setAttachmentInfo(a.id, { date: '2024-04-02' }).then(function () { var s2 = D.suggest(b, b.attachments.find(function (y) { return y.id === a.id; })); eq(s2[0].t.id, v.t[3].id); ok(s2[0].sure); });
    });
  }));
  test('DC-05 missing documents: expenses at or over the amount with no file', withBook(function (b) {
    var v;
    return setup(b).then(function (x) { v = x; return b.addAttachment({ ownerId: v.t[1].id, name: 'lease.pdf', dataUrl: url('lease') }); }).then(function () {
      var m = D.missing(b, { from: '2024-01-01', to: '2024-12-31', min: 7500 });
      eq(m.map(function (t) { return t.id; }), [v.t[3].id]);
      eq(D.missing(b, { from: '2024-01-01', to: '2024-12-31', min: 1000 }).length, 3);
    });
  }));
  test('DC-06 clean up finds the same file twice, files on void transactions, and large files', withBook(function (b) {
    var v;
    return setup(b).then(function (x) { v = x; return b.addAttachment({ ownerId: v.t[0].id, name: 'a.pdf', dataUrl: url('same') }); })
      .then(function () { return b.addAttachment({ ownerId: v.t[0].id, name: 'a copy.pdf', dataUrl: url('same') }); })
      .then(function () { return b.addAttachment({ ownerId: v.t[2].id, name: 'void.pdf', dataUrl: url('other') }); })
      .then(function () { return b.voidTransaction(v.t[2].id, 'test'); })
      .then(function () {
        var c = D.cleanup(b, { large: 1 });
        eq(c.dupes.map(function (a) { return a.name; }), ['a copy.pdf']);
        eq(c.onVoid.map(function (a) { return a.name; }), ['void.pdf']);
        eq(c.large.length, 3);
      });
  }));
  test('DC-07 the CPA package names files by date, vendor and amount and adds an index', withBook(function (b) {
    var v;
    return setup(b).then(function (x) { v = x; return b.addAttachment({ ownerId: v.t[0].id, name: 'scan.pdf', dataUrl: url('r1') }); })
      .then(function () { return b.addAttachment({ ownerId: v.t[1].id, name: 'lease.pdf', dataUrl: url('r2') }); })
      .then(function () { return b.addAttachment({ ownerId: v.t[3].id, name: 'april.pdf', dataUrl: url('r3') }); })
      .then(function () {
        var p = D.packageFiles(b, { from: '2024-03-01', to: '2024-03-31' });
        eq(p.files.map(function (f) { return f.name; }), ['2024-03-01 - Pine Street LLC - 1500.00 - Check 1001.pdf', '2024-03-05 - Office Mart - 45.10 - Check.pdf', 'Index.csv']);
        ok(/Office Mart/.test(new TextDecoder().decode(p.files[2].data)));
        eq(p.missing, 1);
        var zip = OB.xlsx.zip(p.files); ok(zip.length > 100 && zip[0] === 0x50 && zip[1] === 0x4b, 'a zip');
      });
  }));
})(typeof window !== 'undefined' ? window : global);
