# VaultBook audit against the "Offline US Accounting Product" ER design

- Date: 2026-11-05. App 1.12.1, data format 4.
- Source: the user's `er-diagram.md` (60 tables in 7 areas).
- Scope: features and structure only. As the user asked, the storage technology stays as it is: the ER design's SQLite, one file per company, becomes IndexedDB with one database per company (`OfflineBooksUS_<id>`). Stores and identifiers are kept. New data goes in as versioned, additive migrations.

Legend: **Have** = implemented and tested · **Partial** = exists but weaker than the design · **Missing** = not in VaultBook.

## 1. Principles in the design's "rules for the AI coder"

| # | Design rule | VaultBook today | Verdict |
|---|---|---|---|
| 1 | Money in integer cents, no floating point | All amounts are integer cents (`U.toCents`, `Math.round(qty × rate)`) | **Have** |
| 2 | Signed ledger lines; each version sums to 0 | `buildSplits` gives signed splits; `validate` rejects anything that doesn't sum to 0; `checkIntegrity` re-checks | **Have** |
| 3 | Posted transactions are never updated in place; versions plus reversal; void = reversal + status | An edit replaces the record and bumps `version`; the old record is kept as a `before` copy in the audit log. Void sets `status: 'void'` and keeps the record. There are no reversal lines, and the history is in the audit store, not in a version table. | **Partial.** The effect is equivalent for reports, because voids and edits drop out cleanly. A full version table is a storage redesign that the user excluded. |
| 4 | Reports read lines only; balances are caches | Every report is computed from `splits` (`R.entries`); open balances are computed from applications | **Have** |
| 5 | Append-only, hash-chained audit log | The audit store is append-only, but the entries aren't chained, so a tampered or deleted entry isn't detectable | **Partial → fix in 1.13** |
| 6 | Enumerations as checked text values | Types are validated against `S.TXN_TYPES`, `S.ACCOUNT_TYPES` and `S.ITEM_TYPES` | **Have** |

## 2. Area by area

### Company, security, system
| Design table | VaultBook | Verdict |
|---|---|---|
| COMPANY (legal name, EIN, entity, FY start, basis, books start, closing date, closing password) | Name, legal name, EIN, address, FY start month, basis, closing date | **Partial.** No closing-date password. Entity type and books start date are missing. |
| FISCAL_PERIOD | Derived from the FY start month | **Have** (derived) |
| USER / ROLE / ROLE_RIGHT / USER_ROLE | Single-user app with company password encryption (AES-GCM) | **Missing** by design; low value in a one-person browser app |
| FEATURE_SWITCH | `useClasses`, `useBudgets`, `use1099` | **Partial.** No switches yet for sales tax, estimates or purchase orders. |
| CLOSING_DATE_HISTORY | Only the current date is stored | **Missing → 1.13** |
| AUDIT_EVENT | Audit store with `before` copies; Audit trail screen | **Partial.** Not hash-chained → 1.13. |
| BACKUP_LOG | `lastBackupAt` only | **Partial** |
| DATA_PACK (tax-rate/1099 packs) | 1099 thresholds are in code | **Missing** (low) |

### Chart of accounts
| Design | VaultBook | Verdict |
|---|---|---|
| ACCOUNT (number, type, parent, system role, normal balance, active) | All of these (`system`: AR, AP, UNDEP, OBE, RE, UNCAT_*) | **Have** |
| REPORT_GROUP roll-up tree | Statement designer groups (templates) | **Have** (in the designer) |
| cash_flow_class / tax_line | Cash flow uses the account type | **Partial** (low) |
| BANK_ACCOUNT_INFO (routing, next check no., ACH id) | Check counter only | **Missing** (needed only for check printing / ACH) |

### Parties and dimensions
| Design | VaultBook | Verdict |
|---|---|---|
| PARTY (customer/vendor, terms, 1099, TIN, credit limit, default account) | Customer/vendor, terms (days), `is1099`, `taxId`, extended QuickBooks fields; the credit limit is stored as text | **Partial.** The credit limit is never checked, and contacts have no sales-tax default. |
| PARTY_ADDRESS (bill/ship/remit) | `address` and `shipAddress` text | **Partial** |
| JOB (Customer:Job) | Classes can stand in for jobs | **Partial** |
| TERMS (net days, discount days, discount %) | Net days only | **Partial.** No early-payment discounts. |
| PRICE_LEVEL | — | **Missing** |
| TRACKING_CLASS | Classes with parent/child, per line | **Have** |
| LOCATION | — | **Missing** (belongs with inventory) |
| EXEMPTION_CERTIFICATE | — | **Missing** (belongs with sales tax) |

### Items and inventory
| Design | VaultBook | Verdict |
|---|---|---|
| ITEM (type, SKU, price, cost, income/COGS/asset/expense accounts, taxable) | All except COGS account and costing | **Partial** |
| ITEM_STOCK, COST_LAYER(_USE), LOT_SERIAL, ASSEMBLY_COMPONENT, UNIT | — | **Missing.** Quantities are not tracked and no COGS is posted automatically (open MIG-005). |
| PRICE_LEVEL_ITEM | — | **Missing** |

### Sales tax
| Design | VaultBook | Verdict |
|---|---|---|
| TAX_AGENCY, TAX_JURISDICTION, TAX_RATE, TAX_CODE(_COMPONENT), NEXUS_REGISTRATION, TAX_LINE | There is a "Sales Tax Payable" account, an item "Taxable" checkbox that does nothing, and a "Sales tax item" type | **Missing.** This is the largest gap for a US product: no tax is ever calculated on an invoice or sales receipt, and there's no liability report. **→ 1.13** |

### Transactions
| Design | VaultBook | Verdict |
|---|---|---|
| TXN_TYPE list | invoice, sales receipt, customer payment, credit memo, customer refund, bill, bill payment, vendor credit, expense, check, CC credit, deposit, transfer, journal | **Partial.** Missing: estimate, sales order, purchase order, item receipt, sales-tax payment/adjustment, inventory adjustment and build, payroll journal. |
| NUMBER_SEQUENCE | Per-type counters, duplicate-number check for sales documents | **Have** |
| TXN header (number, dates, party, status, open balance, version, locked) | Yes (`status` posted/void, `version`, open balance computed) | **Have** |
| LEDGER_LINE (account, signed amount, party, class, memo) | `splits` | **Have** |
| ITEM_LINE (item, qty, rate, amount) | `lines` with `itemId`, `qty`, `rate` | **Have** (no inventory movement) |
| TAX_LINE | — | **Missing → 1.13** |
| APPLICATION (amount, discount) | `applications` with amount | **Partial.** No discount. |
| DOC_LINK (estimate → invoice, PO → bill) | — | **Missing → 1.13** (estimate → invoice, PO → bill) |
| APPROVAL | — | **Missing** (multi-user only) |
| ATTACHMENT | — | **Missing** |
| RECURRING_TEMPLATE | Memorized/recurring transactions with remind or auto | **Have** |

### Banking
| Design | VaultBook | Verdict |
|---|---|---|
| STATEMENT / STATEMENT_LINE / BANK_MATCH (CSV/OFX/QFX/PDF import and matching) | Bank import (CSV/OFX/QFX), PDF statement import with OCR, duplicate detection | **Have** |
| PAYEE_RULE | Bank rules | **Have** |
| RECONCILIATION (finish, undo, difference) | Reconcile, finish, undo last | **Have** |
| BANK_DETAIL cleared status | Per-split `cleared` (C/R) | **Have** |
| CHECK_STOCK / CHECK_NUMBER, check printing | Check numbers only | **Missing** |
| PAYMENT_EXPORT (NACHA, positive pay) | — | **Missing** |

### 1099, budgets, payroll, reports
| Design | VaultBook | Verdict |
|---|---|---|
| FORM1099_MAP / RUN / LINE | Account → box map, summary and detail reports, thresholds by year | **Have** (no e-file export) |
| BUDGET / BUDGET_LINE (account, class, month) | Budgets by account and month; Budget vs. Actuals | **Have** |
| PAYROLL_IMPORT | — | **Missing** (journal entries can be used instead) |
| REPORT_DEFINITION | Saved (memorized) reports, custom report builder, statement designer | **Have** |

## 3. Summary

- **Ledger core:** this is where the design matters most, and VaultBook already meets it: cents, balanced lines, line-based reports, voids, a closing date, and validation on every path including imports.
- **Main shortfall:** whole business areas are missing — sales tax, non-posting documents (estimates, POs), inventory, and a tamper-evident history.

## 4. Plan

**1.13.0 (this session):**
1. **Sales tax:**
   - Tax rates list (name, agency, rate %, liability account).
   - A taxable flag per line (from the item) and a tax rate on invoices, sales receipts and credit memos, computed in cents and posted to Sales Tax Payable.
   - Tax shown on the screen, the printed/PDF invoice and the .iif export.
   - A Sales Tax Liability report.
   - Customer tax-exempt flag and default rate.
2. **Estimates and purchase orders:** non-posting documents (no ledger effect) with Open/Closed status, convertible to an invoice or bill. The invoice/bill records where it came from (DOC_LINK).
3. **Tamper-evident audit trail:** each audit entry carries `hashPrev`/`hash` (SHA-256), and the integrity check reports any break. Closing-date changes are recorded in a history, with an optional closing-date password.
4. **Credit limit warning** when an invoice would take a customer over their limit.

**Later (needs the user's go-ahead; larger):**
- Inventory quantities with average cost and automatic COGS.
- Customer:Job.
- Early-payment discount terms.
- Price levels.
- Attachments.
- Check printing / NACHA.
- Multi-user roles.
