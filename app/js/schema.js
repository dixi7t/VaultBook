/* OfflineBooks US — schema, chart-of-accounts templates, transaction types, migrations. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var S = OB.schema = {};

  S.APP_VERSION = '1.55.2';
  S.DATA_VERSION = 8;        // company data schema version (see migrations below)
  S.BACKUP_FORMAT = 'OfflineBooksUS-Backup';

  /* Extra contact fields (1.9, QuickBooks-compatible): stored as text, optional. */
  S.CONTACT_EXTRA = ['firstName', 'lastName', 'contactName', 'altPhone', 'fax', 'website', 'shipAddress', 'accountNo', 'creditLimit', 'type', 'paymentTerms'];

  /* Products & services (items). Items prefill invoice/bill lines (account, description, rate). */
  S.ITEM_TYPES = [
    { id: 'service', label: 'Service' }, { id: 'noninventory', label: 'Non-inventory part' }, { id: 'inventory', label: 'Inventory part' },
    { id: 'othercharge', label: 'Other charge' }, { id: 'discount', label: 'Discount' }, { id: 'payment', label: 'Payment' },
    { id: 'subtotal', label: 'Subtotal' }, { id: 'group', label: 'Group' }, { id: 'salestax', label: 'Sales tax item' }, { id: 'fixedasset', label: 'Fixed asset' }
  ];

  /* Account types. normal: 'D' debit-normal, 'C' credit-normal. */
  S.ACCOUNT_TYPES = [
    { id: 'bank', label: 'Bank', cls: 'asset', normal: 'D', cash: true, bs: 'Current Assets' },
    { id: 'ar', label: 'Accounts Receivable (A/R)', cls: 'asset', normal: 'D', bs: 'Current Assets' },
    { id: 'oca', label: 'Other Current Asset', cls: 'asset', normal: 'D', bs: 'Current Assets' },
    { id: 'fixed', label: 'Fixed Asset', cls: 'asset', normal: 'D', bs: 'Fixed Assets' },
    { id: 'oa', label: 'Other Asset', cls: 'asset', normal: 'D', bs: 'Other Assets' },
    { id: 'ap', label: 'Accounts Payable (A/P)', cls: 'liability', normal: 'C', bs: 'Current Liabilities' },
    { id: 'cc', label: 'Credit Card', cls: 'liability', normal: 'C', bs: 'Current Liabilities', card: true },
    { id: 'ocl', label: 'Other Current Liability', cls: 'liability', normal: 'C', bs: 'Current Liabilities' },
    { id: 'ltl', label: 'Long Term Liability', cls: 'liability', normal: 'C', bs: 'Long-Term Liabilities' },
    { id: 'equity', label: 'Equity', cls: 'equity', normal: 'C', bs: 'Equity' },
    { id: 'income', label: 'Income', cls: 'income', normal: 'C', pl: 'Income' },
    { id: 'oi', label: 'Other Income', cls: 'income', normal: 'C', pl: 'Other Income' },
    { id: 'cogs', label: 'Cost of Goods Sold', cls: 'expense', normal: 'D', pl: 'Cost of Goods Sold' },
    { id: 'expense', label: 'Expense', cls: 'expense', normal: 'D', pl: 'Expenses' },
    { id: 'oe', label: 'Other Expense', cls: 'expense', normal: 'D', pl: 'Other Expenses' }
  ];
  S.TYPE = {};
  S.ACCOUNT_TYPES.forEach(function (t) { S.TYPE[t.id] = t; });
  S.isBS = function (type) { var t = S.TYPE[type]; return t && (t.cls === 'asset' || t.cls === 'liability' || t.cls === 'equity'); };
  S.isPL = function (type) { var t = S.TYPE[type]; return t && (t.cls === 'income' || t.cls === 'expense'); };

  /* Default chart of accounts for a US small business (QuickBooks-style naming). */
  S.DEFAULT_ACCOUNTS = [
    ['1000', 'Checking', 'bank'],
    ['1010', 'Savings', 'bank'],
    ['1050', 'Petty Cash', 'bank'],
    ['1100', 'Accounts Receivable (A/R)', 'ar', 'AR'],
    ['1200', 'Undeposited Funds', 'oca', 'UNDEP'],
    ['1300', 'Inventory Asset', 'oca', 'INV'],
    ['1400', 'Prepaid Expenses', 'oca'],
    ['1500', 'Furniture and Equipment', 'fixed'],
    ['1510', 'Vehicles', 'fixed'],
    ['1590', 'Accumulated Depreciation', 'fixed'],
    ['1800', 'Security Deposits', 'oa'],
    ['2000', 'Accounts Payable (A/P)', 'ap', 'AP'],
    ['2100', 'Business Credit Card', 'cc'],
    ['2200', 'Sales Tax Payable', 'ocl', 'STAX'],
    ['2300', 'Payroll Liabilities', 'ocl'],
    ['2700', 'Loan Payable', 'ltl'],
    ['3000', 'Opening Balance Equity', 'equity', 'OBE'],
    ['3100', "Owner's Investment", 'equity'],
    ['3200', "Owner's Draw", 'equity'],
    ['3900', 'Retained Earnings', 'equity', 'RE'],
    ['4000', 'Sales', 'income'],
    ['4100', 'Services', 'income'],
    ['4900', 'Uncategorized Income', 'income', 'UNCAT_INC'],
    ['5000', 'Cost of Goods Sold', 'cogs'],
    ['6000', 'Advertising & Marketing', 'expense'],
    ['6050', 'Bank Charges & Fees', 'expense'],
    ['6100', 'Car & Truck', 'expense'],
    ['6150', 'Contractors', 'expense'],
    ['6200', 'Insurance', 'expense'],
    ['6250', 'Legal & Professional Services', 'expense'],
    ['6300', 'Meals', 'expense'],
    ['6350', 'Office Supplies & Software', 'expense'],
    ['6400', 'Rent & Lease', 'expense'],
    ['6450', 'Repairs & Maintenance', 'expense'],
    ['6500', 'Taxes & Licenses', 'expense'],
    ['6550', 'Travel', 'expense'],
    ['6600', 'Utilities', 'expense'],
    ['6650', 'Payroll Expenses', 'expense'],
    ['6900', 'Uncategorized Expense', 'expense', 'UNCAT_EXP'],
    ['7000', 'Interest Earned', 'oi'],
    ['8000', 'Depreciation', 'oe'],
    ['8100', 'Interest Expense', 'oe']
  ];

  /*
   * Transaction types.
   *  head:      the single "header" account (AR/AP system account, or the account chosen on the form)
   *  headSide:  'D' or 'C' — which side the header account sits on; item lines take the other side
   *  contact:   'customer' | 'vendor' | 'any' | null
   *  applies:   which types this transaction can be applied against
   */
  /*  taxable:   lines can carry sales tax (invoice, sales receipt, credit memo, estimate)
   *  nonPosting: a document with no ledger effect (estimate, purchase order); status 'open' | 'closed' | 'void'
   *  convertsTo: the posting type a non-posting document becomes (estimate -> invoice, PO -> bill) */
  S.TXN_TYPES = {
    estimate:       { label: 'Estimate', nonPosting: true, head: 'AR', headSide: 'D', contact: 'customer', group: 'sales', prefix: 'EST-', convertsTo: 'invoice', taxable: true },
    salesOrder:     { label: 'Sales Order', nonPosting: true, head: 'AR', headSide: 'D', contact: 'customer', group: 'sales', prefix: 'SO-', convertsTo: 'invoice', taxable: true },
    invoice:        { label: 'Invoice', head: 'AR', headSide: 'D', contact: 'customer', group: 'sales', prefix: 'INV-', taxable: true },
    salesReceipt:   { label: 'Sales Receipt', head: 'account', headSide: 'D', contact: 'customer', group: 'sales', prefix: 'SR-', taxable: true },
    payment:        { label: 'Customer Payment', special: true, contact: 'customer', group: 'sales', applies: ['invoice'] },
    creditMemo:     { label: 'Credit Memo', head: 'AR', headSide: 'C', contact: 'customer', group: 'sales', applies: ['invoice'], prefix: 'CM-', taxable: true },
    customerRefund: { label: 'Customer Refund', special: true, contact: 'customer', group: 'sales', applies: ['creditMemo', 'payment'] },
    purchaseOrder:  { label: 'Purchase Order', nonPosting: true, head: 'AP', headSide: 'C', contact: 'vendor', group: 'purchases', prefix: 'PO-', convertsTo: 'bill' },
    bill:           { label: 'Bill', head: 'AP', headSide: 'C', contact: 'vendor', group: 'purchases' },
    billPayment:    { label: 'Bill Payment', special: true, contact: 'vendor', group: 'purchases', applies: ['bill'] },
    vendorCredit:   { label: 'Vendor Credit', head: 'AP', headSide: 'D', contact: 'vendor', group: 'purchases', applies: ['bill'] },
    vendorRefund:   { label: 'Vendor Refund', special: true, contact: 'vendor', group: 'purchases', applies: ['vendorCredit', 'billPayment'] },   // CPA-04: money back from a vendor
    expense:        { label: 'Expense', head: 'account', headSide: 'C', contact: 'any', group: 'purchases' },
    check:          { label: 'Check', head: 'account', headSide: 'C', contact: 'any', group: 'purchases' },
    ccCredit:       { label: 'Credit Card Credit', head: 'account', headSide: 'D', contact: 'any', group: 'purchases' },
    deposit:        { label: 'Deposit', head: 'account', headSide: 'D', contact: 'any', group: 'banking' },
    transfer:       { label: 'Transfer', special: true, contact: null, group: 'banking' },
    journal:        { label: 'Journal Entry', special: true, contact: null, group: 'journal', prefix: 'JE-' },
    invAdjust:      { label: 'Inventory Adjustment', special: true, contact: null, group: 'journal', prefix: 'ADJ-' }
  };

  /* Which account types may be used as the header account for each type. */
  S.HEAD_ACCOUNT_TYPES = {
    salesReceipt: ['bank', 'oca'],
    payment: ['bank', 'oca'],
    customerRefund: ['bank', 'cc'],
    vendorRefund: ['bank', 'oca', 'cc'],
    billPayment: ['bank', 'cc'],
    expense: ['bank', 'cc'],
    check: ['bank'],
    ccCredit: ['cc'],
    deposit: ['bank', 'oca'],
    transfer: ['bank', 'cc', 'oca', 'ocl', 'ltl']
  };

  /* 1099 boxes an expense account can be mapped to. */
  S.BOXES_1099 = [
    { id: 'NEC1', form: '1099-NEC', box: '1', label: 'Nonemployee compensation' },
    { id: 'MISC1', form: '1099-MISC', box: '1', label: 'Rents' },
    { id: 'MISC2', form: '1099-MISC', box: '2', label: 'Royalties' },
    { id: 'MISC3', form: '1099-MISC', box: '3', label: 'Other income' },
    { id: 'MISC6', form: '1099-MISC', box: '6', label: 'Medical and health care payments' },
    { id: 'MISC10', form: '1099-MISC', box: '10', label: 'Gross proceeds paid to an attorney' }
  ];
  /** Reporting threshold per box, in cents. Payments made after 2025 use the $2,000 threshold (2025 tax law);
   *  royalties stay at $10. Earlier years use $600. */
  S.threshold1099 = function (boxId, year) {
    if (boxId === 'MISC2') return 1000;
    return +year >= 2026 ? 200000 : 60000;
  };

  S.newCompany = function (opts) {
    var U = OB.util;
    return {
      id: U.uid('co'),
      name: opts.name || 'My Company',
      legalName: opts.legalName || '',
      ein: opts.ein || '',
      address: opts.address || '',
      email: opts.email || '',
      phone: opts.phone || '',
      currency: 'USD',
      basis: opts.basis === 'cash' ? 'cash' : 'accrual',
      fiscalYearStartMonth: +opts.fiscalYearStartMonth || 1,
      closingDate: '',              // books closed through this date (optional lock)
      defaultTerms: 30,
      imports: [],                  // migration (import) history, newest last
      dataVersion: S.DATA_VERSION,
      createdAt: new Date().toISOString(),
      lastBackupAt: '',
      useClasses: false,            // features (Settings > Features): tag lines with classes (departments, locations, jobs)
      useBudgets: true,             //   budgets and Budget vs. Actuals
      use1099: true,                //   1099 contractor tracking and reports
      map1099: {},                  // accountId -> 1099 box code (see S.BOXES_1099)
      counters: { invoice: 1001, journal: 1, creditMemo: 1, salesReceipt: 1001, check: 1001, estimate: 1001, purchaseOrder: 1001, invAdjust: 1, salesOrder: 1001 },
      priceLevels: [],              // price levels (1.17): { id, name, method 'pct'|'item', pct, prices { itemId: cents } }
      fixedAssets: [],              // fixed asset register (1.15)
      taxForm: '',                  // income tax return for tax-line mapping (1.16): 1040C | 1120S | 1065 | 1120
      taxLines: {},                 // accountId -> tax line code
      salesTaxes: [],               // sales tax rates (1.13): { id, name, agency, rate (millionths: 8.25% = 82500), accountId, active }
      defaultSalesTaxId: '',
      closingHistory: []            // closing-date changes, newest last (1.13)
    };
  };

  S.defaultAccounts = function () {
    var U = OB.util;
    return S.DEFAULT_ACCOUNTS.map(function (a) {
      return { id: U.uid('acct'), number: a[0], name: a[1], type: a[2], system: a[3] || '', description: '', active: true, parentId: '' };
    });
  };

  /*
   * Company data migrations. Each takes a full company dataset object
   * { company, accounts, contacts, transactions, rules, recurring, reconciliations, audit }
   * and upgrades it in place to the next version. Used on load and on backup restore.
   */
  S.MIGRATIONS = {
    // v1 -> v2: introduce counters + per-split cleared flags + rules array
    1: function (d) {
      d.company.counters = d.company.counters || { invoice: 1001, journal: 1, creditMemo: 1, salesReceipt: 1001, check: 1001 };
      (d.transactions || []).forEach(function (t) {
        (t.splits || []).forEach(function (s) { if (s.cleared === undefined) s.cleared = ''; });
      });
      d.rules = d.rules || [];
      d.company.dataVersion = 2;
    },
    // v2 -> v3 (app 1.7): classes, budgets, saved reports, 1099 account mapping
    2: function (d) {
      d.classes = d.classes || [];
      d.budgets = d.budgets || [];
      d.reports = d.reports || [];
      if (d.company.useClasses === undefined) d.company.useClasses = false;
      if (d.company.useBudgets === undefined) d.company.useBudgets = true;
      if (d.company.use1099 === undefined) d.company.use1099 = true;
      d.company.map1099 = d.company.map1099 || {};
      d.company.dataVersion = 3;
    },
    // v3 -> v4 (app 1.9): products & services (items) list, migration (import) history
    3: function (d) {
      d.items = d.items || [];
      d.company.imports = d.company.imports || [];
      d.company.dataVersion = 4;
    },
    // v4 -> v5 (app 1.13): sales tax rates, estimates / purchase orders numbering, closing-date history
    4: function (d) {
      var c = d.company;
      c.salesTaxes = c.salesTaxes || [];
      c.defaultSalesTaxId = c.defaultSalesTaxId || '';
      c.closingHistory = c.closingHistory || [];
      c.counters = c.counters || {};
      if (c.counters.estimate === undefined) c.counters.estimate = 1001;
      if (c.counters.purchaseOrder === undefined) c.counters.purchaseOrder = 1001;
      // mark the Sales Tax Payable account as the system sales-tax account (only if none is marked)
      var accs = d.accounts || [];
      if (!accs.some(function (a) { return a.system === 'STAX'; })) {
        var st = accs.find(function (a) { return !a.system && a.type === 'ocl' && /sales\s*tax\s*payable/i.test(a.name); });
        if (st) st.system = 'STAX';
      }
      c.dataVersion = 5;
    },
    // v5 -> v6 (app 1.15): inventory adjustments numbering, Inventory Asset system account, fixed asset register
    5: function (d) {
      var c = d.company;
      c.counters = c.counters || {}; if (c.counters.invAdjust === undefined) c.counters.invAdjust = 1;
      c.fixedAssets = c.fixedAssets || [];
      var accs = d.accounts || [];
      if (!accs.some(function (a) { return a.system === 'INV'; })) {
        var ia = accs.find(function (a) { return !a.system && a.type === 'oca' && /^inventory( asset)?$/i.test(a.name.trim()); });
        if (ia) ia.system = 'INV';
      }
      c.dataVersion = 6;
    },
    // v6 -> v7 (app 1.16): attachments store, tax-line mapping
    6: function (d) {
      d.attachments = d.attachments || [];
      d.company.taxForm = d.company.taxForm || '';
      d.company.taxLines = d.company.taxLines || {};
      d.company.dataVersion = 7;
    },
    // v7 -> v8 (app 1.17): sales orders numbering, price levels
    7: function (d) {
      var c = d.company; c.counters = c.counters || {};
      if (c.counters.salesOrder === undefined) c.counters.salesOrder = 1001;
      c.priceLevels = c.priceLevels || [];
      c.dataVersion = 8;
    }
  };
  S.migrate = function (d) {
    var v = d.company.dataVersion || 1;
    var applied = [];
    if (v > S.DATA_VERSION) throw new Error('This data was created by a newer version of VaultBook (data v' + v + '). Update the app first.');
    while (v < S.DATA_VERSION) {
      var m = S.MIGRATIONS[v];
      if (!m) throw new Error('No migration from data version ' + v);
      m(d); applied.push(v + '→' + (v + 1)); v = d.company.dataVersion;
    }
    return applied;
  };
})(typeof window !== 'undefined' ? window : globalThis);
