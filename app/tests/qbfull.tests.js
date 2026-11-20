/* VaultBook — full QuickBooks Desktop export → VaultBook (1.32) tests. Loaded after qbsync.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  var R = function (n) { return { FullName: n }; };

  // A small company as the connector's "Export everything" writes it (qbXML Ret elements as JSON; single children are objects, repeats arrays)
  function full() {
    return { format: 'vaultbook-qb-full', version: 1, at: '2026-11-12T23:00:00.000Z', from: '', to: '2026-11-12',
      company: { CompanyName: 'Radiology One Inc' },
      lists: {
        Account: [
          { FullName: 'Chase 6863', Name: 'Chase 6863', AccountType: 'Bank', AccountNumber: '10100', Balance: '1650.00', IsActive: 'true' },
          { FullName: 'Accounts Receivable', Name: 'Accounts Receivable', AccountType: 'AccountsReceivable', AccountNumber: '11000', Balance: '300.00', SpecialAccountType: 'AccountsReceivable' },
          { FullName: 'Undeposited Funds', Name: 'Undeposited Funds', AccountType: 'OtherCurrentAsset', Balance: '0.00', SpecialAccountType: 'UndepositedFunds' },
          { FullName: 'Accounts Payable', Name: 'Accounts Payable', AccountType: 'AccountsPayable', Balance: '0.00', SpecialAccountType: 'AccountsPayable' },
          { FullName: 'Sales Tax Payable', Name: 'Sales Tax Payable', AccountType: 'OtherCurrentLiability', Balance: '0.00', SpecialAccountType: 'SalesTaxPayable' },
          { FullName: 'Opening Balance Equity', Name: 'Opening Balance Equity', AccountType: 'Equity', Balance: '1500.00', SpecialAccountType: 'OpeningBalanceEquity' },
          { FullName: 'Income', Name: 'Income', AccountType: 'Income', AccountNumber: '43000' },
          { FullName: 'Income:Fee for Professional Services', Name: 'Fee for Professional Services', AccountType: 'Income', AccountNumber: '43700' },
          { FullName: 'Consulting Fees', Name: 'Consulting Fees', AccountType: 'Expense', AccountNumber: '60100' },
          { FullName: 'Bank Charges', Name: 'Bank Charges', AccountType: 'Expense', AccountNumber: '60200', IsActive: 'false' }],
        Customer: [{ FullName: 'DM RADS, LLC', Name: 'DM RADS, LLC', CompanyName: 'DM Rads PLLC', BillAddress: { Addr1: 'DM Rads PLLC', Addr2: '1 Main St', City: 'Mesa', State: 'AZ', PostalCode: '85201' }, Email: 'ap@dmrads.example', TermsRef: R('Net 15') }],
        Vendor: [{ Name: 'Dr. Smith', CompanyName: 'Smith Radiology', IsVendorEligibleFor1099: 'true', VendorTaxIdent: '12-3456789' }],
        Employee: [], OtherName: [],
        Item: [{ _type: 'ItemServiceRet', FullName: 'Radiology Services', Name: 'Radiology Services', SalesOrPurchase: { Desc: 'Radiology reads', Price: '100.00', AccountRef: R('Income:Fee for Professional Services') } }],
        Class: [{ FullName: 'Phoenix', Name: 'Phoenix', IsActive: 'true' }],
        StandardTerms: [{ Name: 'Net 15', StdDueDays: '15' }]
      },
      txns: {
        Invoice: [
          { TxnID: 'I-1', TxnDate: '2026-08-05', RefNumber: '1243', CustomerRef: R('DM RADS, LLC'), ARAccountRef: R('Accounts Receivable'), DueDate: '2026-08-20', TermsRef: R('Net 15'), Memo: 'July reads', Subtotal: '500.00',
            InvoiceLineRet: [{ ItemRef: R('Radiology Services'), Desc: 'Radiology Services - For Holiday', Quantity: '3', Rate: '100.00', Amount: '300.00', ClassRef: R('Phoenix') }, { ItemRef: R('Radiology Services'), Desc: 'Courier', Amount: '200.00' }] },
          { TxnID: 'I-2', TxnDate: '2026-09-04', RefNumber: '1261', CustomerRef: R('DM RADS, LLC'), Subtotal: '300.00', InvoiceLineGroupRet: { ItemGroupRef: R('Bundle'), InvoiceLineRet: { ItemRef: R('Radiology Services'), Desc: 'Reads', Amount: '300.00' } } }],
        ReceivePayment: [{ TxnID: 'P-1', TxnDate: '2026-08-11', RefNumber: 'ACH', CustomerRef: R('DM RADS, LLC'), ARAccountRef: R('Accounts Receivable'), TotalAmount: '500.00', DepositToAccountRef: R('Chase 6863'),
          AppliedToTxnRet: { TxnID: 'I-1', TxnType: 'Invoice', RefNumber: '1243', Amount: '500.00' } }],
        Check: [{ TxnID: 'C-1', TxnDate: '2026-08-15', RefNumber: '5011', AccountRef: R('Chase 6863'), PayeeEntityRef: R('Dr. Smith'), Amount: '350.00', Memo: 'Aug reads',
          ExpenseLineRet: [{ AccountRef: R('Consulting Fees'), Amount: '340.00', Memo: 'reads' }, { AccountRef: R('Bank Charges'), Amount: '10.00' }] }],
        Deposit: [{ TxnID: 'D-1', TxnDate: '2026-08-20', DepositToAccountRef: R('Chase 6863'), DepositTotal: '1500.00', Memo: 'Owner money',
          DepositLineRet: { AccountRef: R('Opening Balance Equity'), Amount: '1500.00', Memo: 'capital' } }],
        JournalEntry: [{ TxnID: 'J-1', TxnDate: '2026-08-31', RefNumber: 'ADJ-1', JournalDebitLine: { AccountRef: R('Bank Charges'), Amount: '0.00' }, JournalCreditLine: { AccountRef: R('Chase 6863'), Amount: '0.00' } }]
      } };
  }

  test('QF-01 lists: accounts (types, numbers, parents, inactive, special), customers with address and terms, vendors 1099, items with income account, classes, terms', function () {
    var m = OB.qbfull.toModel(full());
    var a = {}; m.accounts.forEach(function (r) { a[r.NAME] = r; });
    eq(a['Chase 6863'].ACCNTTYPE, 'BANK'); eq(a['Chase 6863'].ACCNUM, '10100'); eq(a['Income:Fee for Professional Services'].ACCNTTYPE, 'INC');
    eq(a['Opening Balance Equity'].EXTRA, 'OPENBAL'); eq(a['Undeposited Funds'].EXTRA, 'UNDEPOSIT'); eq(a['Bank Charges'].HIDDEN, 'Y');
    eq(a['Chase 6863'].OBAMOUNT, '1650.00', 'bank balance: debit-normal, as is'); eq(a['Accounts Payable'].OBAMOUNT, '0.00');
    eq(m.customers[0].NAME, 'DM RADS, LLC'); eq(m.customers[0].BADDR2, '1 Main St'); eq(m.customers[0].BADDR3, 'Mesa, AZ 85201'); eq(m.customers[0].TERMS, 'Net 15'); eq(m.customers[0].EMAIL, 'ap@dmrads.example');
    eq(m.vendors[0].NAME, 'Dr. Smith'); eq(m.vendors[0]['1099'], 'Y'); eq(m.vendors[0].TAXID, '12-3456789');
    eq(m.items[0].NAME, 'Radiology Services'); eq(m.items[0].INVITEMTYPE, 'SERV'); eq(m.items[0].ACCNT, 'Income:Fee for Professional Services'); eq(m.items[0].PRICE, '100.00');
    eq(m.classes[0].NAME, 'Phoenix'); eq(m.terms[0].STDDUEDAYS, '15');
    eq(m.source, 'QuickBooks Desktop connector (full export)'); eq(m.company.name, 'Radiology One Inc');
  });

  test('QF-02 transactions: balanced rows per type, item lines post to the item income account, groups expanded, QuickBooks ids and payment links kept, zero journals dropped', function () {
    var m = OB.qbfull.toModel(full()), by = {};
    m.txns.forEach(function (t) { by[t.qbTxnId] = t; });
    eq(m.txns.length, 5, 'zero-amount journal skipped');
    m.txns.forEach(function (t) { eq(U.sum(t.rows, function (r) { return r.amount; }), 0, t.qbType + ' ' + t.qbTxnId + ' balances'); });
    var i1 = by['I-1']; eq(i1.qbType, 'Invoice'); eq(i1.num, '1243'); eq(i1.name, 'DM RADS, LLC'); eq(i1.dueDate, '2026-08-20');
    eq(i1.rows[0].account, 'Accounts Receivable'); eq(i1.rows[0].amount, 50000); eq(i1.rows[1].account, 'Income:Fee for Professional Services'); eq(i1.rows[1].amount, -30000);
    eq(i1.rows[1].memo, 'Radiology Services - For Holiday'); eq(i1.rows[1].item, 'Radiology Services'); eq(i1.rows[1].qty, 3); eq(i1.rows[1].price, 10000); eq(i1.rows[1].cls, 'Phoenix');
    eq(by['I-2'].rows[1].amount, -30000, 'group line expanded');
    var p = by['P-1']; eq(p.qbType, 'Payment'); eq(p.rows[0].account, 'Chase 6863'); eq(p.rows[0].amount, 50000); eq(p.rows[1].account, 'Accounts Receivable'); eq(p.rows[1].amount, -50000);
    eq(JSON.stringify(p.links), JSON.stringify([{ txnId: 'I-1', amount: 50000 }]));
    var c = by['C-1']; eq(c.qbType, 'Check'); eq(c.name, 'Dr. Smith'); eq(c.rows[0].amount, -35000); eq(c.rows.length, 3);
    var d = by['D-1']; eq(d.rows[0].account, 'Chase 6863'); eq(d.rows[0].amount, 150000); eq(d.rows[1].amount, -150000);
  });

  test('QF-03 import into a new company: the exact payment link, numbers, items, classes, inactive account kept, balances tie, QuickBooks ids recorded', function () {
    var b;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Radiology One Inc' }).then(function (x) {
      b = x; var Q = OB.qbimport;
      var model = Q.read([{ name: 'VaultBook-QB-full-Radiology.json', text: JSON.stringify(full()) }]);
      eq(model.source, 'QuickBooks Desktop connector (full export)');
      var p = Q.plan(model, b, {});
      eq(p.errors.length, 0, p.errors.join(' | '));
      eq(p.preview.transactions, 5); eq(p.preview.applications.linked, 1, 'payment applied by the QuickBooks link');
      ok(!p.preview.openingEntry, 'balances are explained by the history: no opening entry');
      return b.importBundle(p.bundle);
    }).then(function () {
      var inv = b.transactions.find(function (t) { return t.type === 'invoice' && t.number === '1243'; });
      var pay = b.transactions.find(function (t) { return t.type === 'payment'; });
      eq(pay.applications.length, 1); eq(pay.applications[0].txnId, inv.id); eq(b.openBalanceAsOf(inv, '2026-12-31'), 0, 'invoice 1243 closed');
      eq(b.openBalanceAsOf(b.transactions.find(function (t) { return t.number === '1261'; }), '2026-12-31'), 30000, 'invoice 1261 open');
      ok(/TxnID I-1/.test(inv.importRef), inv.importRef);
      var ck = b.accounts.find(function (a) { return a.name === 'Chase 6863'; }); eq(b.accountBalance(ck.id), 165000, 'bank ties to QuickBooks 1,650.00');
      eq(b.accountBalance(b.sys('AR').id), 30000, 'A/R ties 300.00');
      var line = inv.lines.find(function (l) { return l.description === 'Radiology Services - For Holiday'; });
      ok(line.itemId && b.itemById[line.itemId].name === 'Radiology Services', 'item kept'); ok(line.classId, 'class kept');
      ok(b.accounts.find(function (a) { return a.name === 'Fee for Professional Services'; }).parentId, 'sub-account under Income');
      var sm = b.contacts.find(function (c) { return c.name === 'Dr. Smith'; }); ok(sm.is1099, '1099 vendor');
      // the sync screen now matches every imported transaction to QuickBooks by its TxnID
      var cmp = OB.qbsync.compare(b, { format: 'vaultbook-qb-snapshot', version: 1, company: 'Radiology One Inc', from: '2026-01-01', to: '2026-12-31',
        txns: [{ txnId: 'I-1', type: 'Invoice', date: '2026-08-05', num: 'X', name: '', amount: '1.00', key: '' }, { txnId: 'C-1', type: 'Check', date: '2026-08-15', num: '', name: '', amount: '0.01', key: '' }], months: [] });
      eq(cmp.matched.filter(function (x) { return x.how === 'txnid'; }).length, 2, 'matched by TxnID even when the snapshot numbers differ');
    });
  });

  test('QF-05 an invoice whose QuickBooks due date is before its date imports with the date as due date, and its payment still applies', function () {
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Radiology One Inc' }).then(function (b) {
      var f = full(), inv = f.txns.Invoice[0]; inv.DueDate = '2020-01-01';
      var p = OB.qbimport.plan(OB.qbimport.read([{ name: 'f.json', text: JSON.stringify(f) }]), b, {});
      eq(p.errors.length, 0, p.errors.join(' | ')); ok(p.warnings.some(function (w) { return /due date earlier/.test(w); }), 'the change is reported');
      return b.importBundle(p.bundle).then(function () {
        var t = b.transactions.find(function (x) { return x.type === "invoice" && x.dueDate === x.date; }); ok(t, 'due date = document date');
      });
    });
  });

  test('QF-04 tie-out: VaultBook against the QuickBooks list balances per account, with differences', function () {
    var b;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Radiology One Inc' }).then(function (x) {
      b = x; var f = full(); var p = OB.qbimport.plan(OB.qbimport.read([{ name: 'f.json', text: JSON.stringify(f) }]), b, {});
      return b.importBundle(p.bundle).then(function () { return f; });
    }).then(function (f) {
      var t = OB.qbfull.tieOut(b, f);
      ok(t.ok, 'everything ties'); ok(t.rows.length >= 4, 'balance sheet accounts listed');
      var bank = t.rows.find(function (r) { return r.name === 'Chase 6863'; }); eq(bank.qb, 165000); eq(bank.vb, 165000); eq(bank.diff, 0);
      f.lists.Account[0].Balance = '1700.00';
      var t2 = OB.qbfull.tieOut(b, f); ok(!t2.ok); eq(t2.rows.find(function (r) { return r.name === 'Chase 6863'; }).diff, -5000);
      eq(t2.counts.qb.Invoice, 2); eq(t2.counts.vb.invoice, 2);
      var sum = OB.qbfull.toModel(full()).fullSummary; ok(sum.summary && sum.lists.Account.length === 10 && sum.txns.Invoice === 2 && !sum.lists.Customer, 'summary keeps balances and counts only');
      ok(OB.qbfull.tieOut(b, sum).ok, 'the tie-out works from the saved summary');
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
