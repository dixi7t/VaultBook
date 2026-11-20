/* VaultBook — full QuickBooks Desktop export (from the connector's "Export everything") → the importer's model (1.32).
 *
 * The connector writes QuickBooks' own answers as JSON: { format: 'vaultbook-qb-full', version: 1, company, at, from, to,
 *   lists: { Account, Customer, Vendor, Employee, OtherName, Item (each with _type = its Ret element), Class, StandardTerms, DateDrivenTerms },
 *   txns:  { Invoice, SalesReceipt, CreditMemo, ReceivePayment, Bill, VendorCredit, BillPaymentCheck, BillPaymentCreditCard,
 *            Check, CreditCardCharge, CreditCardCredit, Deposit, Transfer, JournalEntry, SalesTaxPaymentCheck, ARRefundCreditCard } }
 * Each record is a qbXML *Ret element as an object: a child that occurs once is an object or text, a repeated child an array.
 *
 * OB.qbfull.toModel(full) builds the same model OB.qbimport.read() makes from IIF/CSV files (IIF field names on the lists;
 * txns with signed rows, debit +), plus qbTxnId on every transaction and links (payment → invoice / bill payment → bill)
 * taken from QuickBooks' AppliedToTxnRet, so OB.qbimport.plan() applies payments exactly instead of guessing.
 * OB.qbfull.tieOut(book, full) compares VaultBook balances with QuickBooks' account balances and counts transactions.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, F = OB.qbfull = {};
  var arr = function (x) { return x === null || x === undefined || x === '' ? [] : Array.isArray(x) ? x : [x]; };
  var txt = function (x) { return x === null || x === undefined ? '' : typeof x === 'object' ? (x['#text'] || '') : String(x); };
  var ref = function (x) { return x ? txt(x.FullName || x.Name || '') : ''; };
  var cents = function (v) { var s = txt(v).replace(/[^0-9.\-]/g, ''); if (!s) return 0; var n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) : 0; };
  var yes = function (v) { return /^true$/i.test(txt(v)); };
  var day = function (v) { return txt(v).slice(0, 10); };

  // qbXML AccountType → IIF account type code used by the importer
  var ACC = { Bank: 'BANK', AccountsReceivable: 'AR', OtherCurrentAsset: 'OCASSET', FixedAsset: 'FIXASSET', OtherAsset: 'OASSET', AccountsPayable: 'AP', CreditCard: 'CCARD',
    OtherCurrentLiability: 'OCLIAB', LongTermLiability: 'LTLIAB', Equity: 'EQUITY', Income: 'INC', CostOfGoodsSold: 'COGS', Expense: 'EXP', OtherIncome: 'EXINC', OtherExpense: 'EXEXP', NonPosting: 'NONPOSTING' };
  var DEBIT_NORMAL = { BANK: 1, AR: 1, OCASSET: 1, FIXASSET: 1, OASSET: 1 }, CREDIT_NORMAL = { AP: 1, CCARD: 1, OCLIAB: 1, LTLIAB: 1, EQUITY: 1 };
  var SPECIAL = { OpeningBalanceEquity: 'OPENBAL', RetainedEarnings: 'RETEARNINGS', UndepositedFunds: 'UNDEPOSIT' };
  var ITEM = { ItemServiceRet: 'SERV', ItemNonInventoryRet: 'PART', ItemInventoryRet: 'INVENTORY', ItemInventoryAssemblyRet: 'INVENTORY', ItemOtherChargeRet: 'OTHC', ItemDiscountRet: 'DISC',
    ItemSalesTaxRet: 'STAX', ItemSalesTaxGroupRet: 'STAX', ItemPaymentRet: 'PMT', ItemSubtotalRet: 'SUBT', ItemGroupRet: 'GRP', ItemFixedAssetRet: 'FIXEDASSET' };
  // qbXML type → the transaction type text the importer's draft rules recognise
  var QBTYPE = { Invoice: 'Invoice', SalesReceipt: 'Sales Receipt', CreditMemo: 'Credit Memo', ReceivePayment: 'Payment', Bill: 'Bill', VendorCredit: 'Vendor Credit',
    BillPaymentCheck: 'Bill Pmt -Check', BillPaymentCreditCard: 'Bill Pmt -CCard', Check: 'Check', CreditCardCharge: 'Credit Card Charge', CreditCardCredit: 'Credit Card Credit',
    Deposit: 'Deposit', Transfer: 'Transfer', JournalEntry: 'General Journal', SalesTaxPaymentCheck: 'Sales Tax Payment Check', ARRefundCreditCard: 'Customer Refund' };
  F.TYPES = Object.keys(QBTYPE);

  /** Address element → up to five lines (Addr1–5, then "City, ST Zip", then Country). */
  function addr(a) {
    if (!a) return [];
    var l = [1, 2, 3, 4, 5].map(function (i) { return txt(a['Addr' + i]).trim(); }).filter(Boolean);
    var cs = [txt(a.City).trim(), [txt(a.State).trim(), txt(a.PostalCode).trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (cs) l.push(cs); if (txt(a.Country).trim()) l.push(txt(a.Country).trim());
    return l.slice(0, 5);
  }
  function addrFields(row, prefix, lines) { lines.forEach(function (x, i) { row[prefix + (i + 1)] = x; }); }

  F.toModel = function (full) {
    if (!full || full.format !== 'vaultbook-qb-full') throw new Error('This is not a VaultBook full QuickBooks export.');
    var L = full.lists || {}, X = full.txns || {};
    var m = { accounts: [], customers: [], vendors: [], others: [], employees: [], terms: [], items: [], classes: [], txns: [], files: [], warnings: [], errors: [], addresses: {},
      company: { name: txt((full.company || {}).CompanyName), product: 'QuickBooks Desktop (connector)' }, source: 'QuickBooks Desktop connector (full export)', qbo: false };

    /* ---- accounts ---- */
    var accType = {}, special = {}, firstOf = {};
    arr(L.Account).forEach(function (a) {
      var name = ref(a); if (!name) return;
      var code = ACC[txt(a.AccountType)] || txt(a.AccountType);
      var r = { NAME: name, ACCNTTYPE: code, ACCNUM: txt(a.AccountNumber), DESC: txt(a.Desc), HIDDEN: txt(a.IsActive) === 'false' ? 'Y' : 'N' };
      var sp = txt(a.SpecialAccountType); if (SPECIAL[sp]) r.EXTRA = SPECIAL[sp];
      if (sp) special[sp] = special[sp] || name;
      firstOf[code] = firstOf[code] || name;
      // QuickBooks shows balances positive in the account's own direction; the importer wants debit + / credit −
      if (a.Balance !== undefined && sp !== 'RetainedEarnings') {
        if (DEBIT_NORMAL[code]) r.OBAMOUNT = (cents(a.Balance) / 100).toFixed(2);
        else if (CREDIT_NORMAL[code]) r.OBAMOUNT = (-cents(a.Balance) / 100).toFixed(2);
      }
      accType[name] = code;
      m.accounts.push(r);
    });
    var AR = special.AccountsReceivable || firstOf.AR || 'Accounts Receivable', AP = special.AccountsPayable || firstOf.AP || 'Accounts Payable';
    var UF = special.UndepositedFunds || 'Undeposited Funds', STP = special.SalesTaxPayable || 'Sales Tax Payable';

    /* ---- names ---- */
    arr(L.Customer).forEach(function (c) {
      var r = { NAME: ref(c), COMPANYNAME: txt(c.CompanyName), FIRSTNAME: txt(c.FirstName), LASTNAME: txt(c.LastName), PHONE1: txt(c.Phone), PHONE2: txt(c.AltPhone), FAXNUM: txt(c.Fax),
        EMAIL: txt(c.Email), CONT1: txt(c.Contact), TERMS: ref(c.TermsRef), LIMIT: txt(c.CreditLimit), HIDDEN: txt(c.IsActive) === 'false' ? 'Y' : 'N', NOTE: txt(c.Notes), CTYPE: ref(c.CustomerTypeRef) };
      addrFields(r, 'BADDR', addr(c.BillAddress)); addrFields(r, 'SADDR', addr(c.ShipAddress));
      if (r.NAME) m.customers.push(r);
    });
    arr(L.Vendor).forEach(function (v) {
      var r = { NAME: ref(v), COMPANYNAME: txt(v.CompanyName), FIRSTNAME: txt(v.FirstName), LASTNAME: txt(v.LastName), PHONE1: txt(v.Phone), PHONE2: txt(v.AltPhone), FAXNUM: txt(v.Fax),
        EMAIL: txt(v.Email), CONT1: txt(v.Contact), TERMS: ref(v.TermsRef), HIDDEN: txt(v.IsActive) === 'false' ? 'Y' : 'N', NOTE: txt(v.Notes), TAXID: txt(v.VendorTaxIdent), '1099': yes(v.IsVendorEligibleFor1099) ? 'Y' : 'N', VTYPE: ref(v.VendorTypeRef) };
      addrFields(r, 'ADDR', addr(v.VendorAddress));
      if (r.NAME) m.vendors.push(r);
    });
    arr(L.Employee).forEach(function (e) { if (ref(e)) m.employees.push({ NAME: ref(e), HIDDEN: txt(e.IsActive) === 'false' ? 'Y' : 'N' }); });
    arr(L.OtherName).forEach(function (o) { if (ref(o)) m.others.push({ NAME: ref(o), COMPANYNAME: txt(o.CompanyName), HIDDEN: txt(o.IsActive) === 'false' ? 'Y' : 'N' }); });
    arr(L.Class).forEach(function (c) { if (ref(c)) m.classes.push({ NAME: ref(c), HIDDEN: txt(c.IsActive) === 'false' ? 'Y' : 'N' }); });
    arr(L.StandardTerms).forEach(function (t) { m.terms.push({ NAME: ref(t), TERMSTYPE: '0', STDDUEDAYS: txt(t.StdDueDays), STDDISCDAYS: txt(t.StdDiscountDays), DISCPER: txt(t.DiscountPct) }); });
    arr(L.DateDrivenTerms).forEach(function (t) { m.terms.push({ NAME: ref(t), TERMSTYPE: '1', DAYOFMONTHDUE: txt(t.DayOfMonthDue) }); });

    /* ---- items: the account each item posts to when sold / bought ---- */
    var sales = {}, buys = {};
    arr(L.Item).forEach(function (it) {
      var name = ref(it); if (!name) return;
      var t = it._type || '', sp = it.SalesOrPurchase, sap = it.SalesAndPurchase;
      var inc = ref(it.IncomeAccountRef) || (sap && ref(sap.IncomeAccountRef)) || (sp && ref(sp.AccountRef)) || ref(it.AccountRef) || ref(it.DepositToAccountRef) || (t === 'ItemPaymentRet' ? UF : '');
      var exp = ref(it.COGSAccountRef) || (sap && ref(sap.ExpenseAccountRef)) || '';
      var asset = ref(it.AssetAccountRef) || '';
      if (t === 'ItemSalesTaxRet' || t === 'ItemSalesTaxGroupRet') inc = STP;
      sales[name.toLowerCase()] = inc;
      buys[name.toLowerCase()] = asset || exp || (sp && ref(sp.AccountRef)) || inc;
      var desc = txt(it.SalesDesc) || (sap && txt(sap.SalesDesc)) || (sp && txt(sp.Desc)) || txt(it.ItemDesc) || txt(it.Desc);
      var price = txt(it.SalesPrice) || (sap && txt(sap.SalesPrice)) || (sp && (txt(sp.Price) || txt(sp.PricePercent))) || txt(it.TaxRate) || txt(it.DiscountRate);
      m.items.push({ NAME: name, INVITEMTYPE: ITEM[t] || 'OTHC', DESC: desc, ACCNT: inc, COGSACCNT: exp, ASSETACCNT: asset, PRICE: price, COST: txt(it.PurchaseCost) || (sap && txt(sap.PurchaseCost)) || '',
        TAXABLE: ref(it.SalesTaxCodeRef) === 'Tax' ? 'Y' : 'N', HIDDEN: txt(it.IsActive) === 'false' ? 'Y' : 'N', PURCHASEDESC: txt(it.PurchaseDesc) || (sap && txt(sap.PurchaseDesc)) || '' });
    });
    var missingItems = {};
    var itemAcc = function (name, buying) {
      var k = String(name || '').toLowerCase(), a = buying ? buys[k] : sales[k];
      if (!a && name) missingItems[name] = 1;
      return a || '';
    };

    /* ---- transactions ---- */
    var seq = 0, discounts = 0, unknownLines = 0;
    var mk = function (type, x, rows, extra) {
      rows = rows.filter(function (r) { return r.amount; });
      if (!rows.length) return;
      var t = Object.assign({ src: 'Connector', seq: seq++, qbType: QBTYPE[type], qbTxnId: txt(x.TxnID), date: day(x.TxnDate), num: txt(x.RefNumber), name: '', memo: txt(x.Memo),
        dueDate: day(x.DueDate), terms: ref(x.TermsRef), adj: yes(x.IsAdjustment), rows: rows }, extra || {});
      var bal = U.sum(rows, function (r) { return r.amount; });
      if (bal) m.warnings.push('QuickBooks ' + QBTYPE[type] + ' ' + (t.num || t.date) + ' does not balance by ' + U.fmt(bal, { symbol: true }) + ' in the export; check it in QuickBooks.');
      m.txns.push(t);
    };
    var row = function (account, amount, o) { o = o || {}; return { account: account, amount: amount, name: o.name || '', memo: o.memo || '', cls: o.cls || '', item: o.item || '', qty: o.qty === undefined ? null : o.qty, price: o.price === undefined ? null : o.price }; };
    // sales lines (invoice, sales receipt, credit memo): groups expanded, subtotals skipped; sign −1 credits income
    var salesLines = function (x, lineKey, groupKey, sign) {
      var out = [];
      var one = function (l) {
        var item = ref(l.ItemRef), amt = cents(l.Amount); if (!amt) return;
        var acc = itemAcc(item, false);
        if (!acc) unknownLines++;
        out.push(row(acc, sign * amt, { memo: txt(l.Desc), cls: ref(l.ClassRef), item: item, qty: txt(l.Quantity) ? +txt(l.Quantity) : null, price: txt(l.Rate) ? cents(l.Rate) : null }));
      };
      arr(x[lineKey]).forEach(one);
      arr(x[groupKey]).forEach(function (g) { arr(g[lineKey]).forEach(one); });
      return out;
    };
    var expenseLines = function (x, sign) {
      var out = [];
      arr(x.ExpenseLineRet).forEach(function (l) { var a = cents(l.Amount); if (a) out.push(row(ref(l.AccountRef), sign * a, { memo: txt(l.Memo), cls: ref(l.ClassRef), name: ref(l.CustomerRef) })); });
      var item = function (l) { var a = cents(l.Amount); if (!a) return; var it = ref(l.ItemRef), acc = itemAcc(it, true); if (!acc) unknownLines++; out.push(row(acc, sign * a, { memo: txt(l.Desc), cls: ref(l.ClassRef), item: it, qty: txt(l.Quantity) ? +txt(l.Quantity) : null, price: txt(l.Cost) ? cents(l.Cost) : null, name: ref(l.CustomerRef) })); };
      arr(x.ItemLineRet).forEach(item);
      arr(x.ItemGroupLineRet).forEach(function (g) { arr(g.ItemLineRet).forEach(item); });
      return out;
    };
    var links = function (x) { return arr(x.AppliedToTxnRet).map(function (a) { return { txnId: txt(a.TxnID), amount: cents(a.Amount) }; }).filter(function (a) { return a.txnId && a.amount; }); };
    var sum = function (rows) { return U.sum(rows, function (r) { return r.amount; }); };

    arr(X.Invoice).forEach(function (x) {
      var cust = ref(x.CustomerRef), lines = salesLines(x, 'InvoiceLineRet', 'InvoiceLineGroupRet', -1), tax = cents(x.SalesTaxTotal);
      if (tax) lines.push(row(STP, -tax, { memo: 'Sales tax', item: ref(x.ItemSalesTaxRef) }));
      mk('Invoice', x, [row(ref(x.ARAccountRef) || AR, -sum(lines), { name: cust })].concat(lines), { name: cust });
    });
    arr(X.CreditMemo).forEach(function (x) {
      var cust = ref(x.CustomerRef), lines = salesLines(x, 'CreditMemoLineRet', 'CreditMemoLineGroupRet', 1), tax = cents(x.SalesTaxTotal);
      if (tax) lines.push(row(STP, tax, { memo: 'Sales tax' }));
      mk('CreditMemo', x, [row(ref(x.ARAccountRef) || AR, -sum(lines), { name: cust })].concat(lines), { name: cust });
    });
    arr(X.SalesReceipt).forEach(function (x) {
      var cust = ref(x.CustomerRef), lines = salesLines(x, 'SalesReceiptLineRet', 'SalesReceiptLineGroupRet', -1), tax = cents(x.SalesTaxTotal);
      if (tax) lines.push(row(STP, -tax, { memo: 'Sales tax' }));
      mk('SalesReceipt', x, [row(ref(x.DepositToAccountRef) || UF, -sum(lines))].concat(lines), { name: cust });
    });
    arr(X.ReceivePayment).forEach(function (x) {
      var cust = ref(x.CustomerRef), amt = cents(x.TotalAmount);
      mk('ReceivePayment', x, [row(ref(x.DepositToAccountRef) || UF, amt), row(ref(x.ARAccountRef) || AR, -amt, { name: cust })], { name: cust, links: links(x) });
      // early-payment discounts QuickBooks took on the invoices: a separate credit to A/R
      arr(x.AppliedToTxnRet).forEach(function (a) {
        var d = cents(a.DiscountAmount); if (!d) return; discounts++;
        mk('JournalEntry', { TxnID: txt(x.TxnID) + '-disc-' + txt(a.TxnID), TxnDate: x.TxnDate, RefNumber: txt(x.RefNumber), Memo: 'Discount on ' + txt(a.TxnType) + ' ' + txt(a.RefNumber) },
          [row(ref(a.DiscountAccountRef), d, { cls: ref(a.DiscountClassRef) }), row(ref(x.ARAccountRef) || AR, -d, { name: cust })], { name: cust });
      });
    });
    arr(X.ARRefundCreditCard).forEach(function (x) {
      var cust = ref(x.CustomerRef), amt = cents(x.TotalAmount);
      mk('ARRefundCreditCard', x, [row(ref(x.RefundFromAccountRef), -amt), row(ref(x.ARAccountRef) || AR, amt, { name: cust })], { name: cust });
    });
    arr(X.Bill).forEach(function (x) {
      var v = ref(x.VendorRef), lines = expenseLines(x, 1);
      mk('Bill', x, [row(ref(x.APAccountRef) || AP, -sum(lines), { name: v })].concat(lines), { name: v });
    });
    arr(X.VendorCredit).forEach(function (x) {
      var v = ref(x.VendorRef), lines = expenseLines(x, -1);
      mk('VendorCredit', x, [row(ref(x.APAccountRef) || AP, -sum(lines), { name: v })].concat(lines), { name: v });
    });
    arr(X.BillPaymentCheck).forEach(function (x) {
      var v = ref(x.PayeeEntityRef), amt = cents(x.Amount);
      mk('BillPaymentCheck', x, [row(ref(x.BankAccountRef), -amt), row(ref(x.APAccountRef) || AP, amt, { name: v })], { name: v, links: links(x) });
    });
    arr(X.BillPaymentCreditCard).forEach(function (x) {
      var v = ref(x.PayeeEntityRef), amt = cents(x.Amount);
      mk('BillPaymentCreditCard', x, [row(ref(x.CreditCardAccountRef), -amt), row(ref(x.APAccountRef) || AP, amt, { name: v })], { name: v, links: links(x) });
    });
    arr(X.Check).forEach(function (x) {
      var p = ref(x.PayeeEntityRef), lines = expenseLines(x, 1);
      mk('Check', x, [row(ref(x.AccountRef), -sum(lines))].concat(lines), { name: p });
    });
    arr(X.CreditCardCharge).forEach(function (x) {
      var p = ref(x.PayeeEntityRef), lines = expenseLines(x, 1);
      mk('CreditCardCharge', x, [row(ref(x.AccountRef), -sum(lines))].concat(lines), { name: p });
    });
    arr(X.CreditCardCredit).forEach(function (x) {
      var p = ref(x.PayeeEntityRef), lines = expenseLines(x, -1);
      mk('CreditCardCredit', x, [row(ref(x.AccountRef), -sum(lines))].concat(lines), { name: p });
    });
    arr(X.Deposit).forEach(function (x) {
      var lines = arr(x.DepositLineRet).map(function (l) { return row(ref(l.AccountRef), -cents(l.Amount), { name: ref(l.EntityRef), memo: txt(l.Memo), cls: ref(l.ClassRef) }); });
      var cb = x.CashBackInfoRet; if (cb && cents(cb.Amount)) lines.push(row(ref(cb.AccountRef), cents(cb.Amount), { memo: txt(cb.Memo) || 'Cash back' }));
      mk('Deposit', x, [row(ref(x.DepositToAccountRef), -sum(lines))].concat(lines));
    });
    arr(X.Transfer).forEach(function (x) {
      var amt = cents(x.Amount);
      mk('Transfer', x, [row(ref(x.TransferFromAccountRef), -amt), row(ref(x.TransferToAccountRef), amt)]);
    });
    arr(X.JournalEntry).forEach(function (x) {
      var rows = arr(x.JournalDebitLine).map(function (l) { return row(ref(l.AccountRef), cents(l.Amount), { name: ref(l.EntityRef), memo: txt(l.Memo), cls: ref(l.ClassRef) }); })
        .concat(arr(x.JournalCreditLine).map(function (l) { return row(ref(l.AccountRef), -cents(l.Amount), { name: ref(l.EntityRef), memo: txt(l.Memo), cls: ref(l.ClassRef) }); }));
      mk('JournalEntry', x, rows);
    });
    arr(X.SalesTaxPaymentCheck).forEach(function (x) {
      var lines = arr(x.SalesTaxPaymentCheckLine).map(function (l) { return row(STP, cents(l.Amount), { item: ref(l.ItemSalesTaxRef) }); });
      mk('SalesTaxPaymentCheck', x, [row(ref(x.BankAccountRef), -sum(lines))].concat(lines), { name: ref(x.PayeeEntityRef) });
    });

    m.txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq; });
    if (Object.keys(missingItems).length) m.errors.push('These items are used on transactions but are not in the item list of the export: ' + Object.keys(missingItems).slice(0, 12).join(', ') + '. Run Export everything again (it reads every item, active or not).');
    if (discounts) m.warnings.push(discounts + ' early-payment discount' + (discounts === 1 ? '' : 's') + ' taken in QuickBooks came across as journal entries crediting A/R; those invoices may show a small open balance in VaultBook until the credit is applied.');
    if (full.from) m.warnings.push('The export starts on ' + U.fmtDate(full.from) + '; balances from before that date come in as one opening-balance entry.');
    // what the tie-out report needs later (kept by the import screen): QuickBooks' balances and counts, not the transactions
    var counts = {}; Object.keys(X).forEach(function (k) { counts[k] = arr(X[k]).length; });
    m.fullSummary = { format: 'vaultbook-qb-full', summary: true, at: full.at, from: full.from || '', to: full.to || '', company: { CompanyName: m.company.name },
      lists: { Account: arr(L.Account).map(function (a) { return { FullName: ref(a), AccountNumber: txt(a.AccountNumber), AccountType: txt(a.AccountType), SpecialAccountType: txt(a.SpecialAccountType), Balance: txt(a.Balance) }; }) },
      txns: counts, listCounts: { Customer: arr(L.Customer).length, Vendor: arr(L.Vendor).length, Item: arr(L.Item).length, Class: arr(L.Class).length } };
    m.files.push({ name: 'Full export', kind: 'qbfull', label: 'QuickBooks Desktop connector: ' + m.accounts.length + ' accounts, ' + (m.customers.length + m.vendors.length) + ' customers and vendors, ' + m.items.length + ' items, ' + m.txns.length + ' transactions' });
    return m;
  };

  /** Balances and counts: VaultBook (now) against QuickBooks' balance-sheet account balances and transaction counts in the export. */
  F.tieOut = function (book, full) {
    var S = OB.schema, rows = [];
    var find = function (qa) {
      var full2 = ref(qa), num = txt(qa.AccountNumber), leaf = full2.split(':').pop().toLowerCase();
      return book.accounts.find(function (a) { return (num && a.number === num) || book.accountFullName(a).toLowerCase() === full2.toLowerCase(); }) || book.accounts.find(function (a) { return a.name.toLowerCase() === leaf; });
    };
    arr((full.lists || {}).Account).forEach(function (qa) {
      var code = ACC[txt(qa.AccountType)], sp = txt(qa.SpecialAccountType);
      if (!(DEBIT_NORMAL[code] || CREDIT_NORMAL[code]) || sp === 'RetainedEarnings' || qa.Balance === undefined) return;
      var a = find(qa), qb = cents(qa.Balance);
      // compare in the account's own direction, as QuickBooks shows it (liabilities and equity positive when credit)
      var v = a ? (S.TYPE[a.type].normal === 'C' ? -book.rawBalance(a.id) : book.rawBalance(a.id)) : null;
      rows.push({ name: ref(qa), number: txt(qa.AccountNumber), type: txt(qa.AccountType), accountId: a ? a.id : '', qb: qb, vb: v, diff: v === null ? null : v - qb });
    });
    var counts = { qb: {}, vb: {} };
    Object.keys(full.txns || {}).forEach(function (k) { var v = full.txns[k]; counts.qb[k] = typeof v === 'number' ? v : arr(v).length; });
    book.posted().forEach(function (t) { if (/QuickBooks/.test(t.importRef || '')) counts.vb[t.type] = (counts.vb[t.type] || 0) + 1; });
    return { rows: rows, ok: rows.every(function (r) { return r.diff === 0; }), counts: counts, at: full.at, company: txt((full.company || {}).CompanyName) };
  };
})(typeof window !== 'undefined' ? window : globalThis);
