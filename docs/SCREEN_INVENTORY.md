# Screen and Workflow Inventory — VaultBook

> Session 2 (2026-10-22): **V** = `app/tests/dev/vaultbook_ui.py` (40 checks). All screens now use the VaultBook design tokens; 43 screenshots in `reference-ui/after/` (before: `reference-ui/before/`). axe: 0 issues on 28 routes × light/dark × desktop/phone.
> Populated from source (`app/js/ui-*.js`) on 2026-10-22. Runtime comparison so far: 25 routes visited by the a11y audit (light/dark × desktop/phone) and the e2e suite. Dialogs listed from source; not every dialog has been opened at runtime yet (AUD-004 = NEEDS VERIFICATION).
> "Tests" = existing automated coverage: **N** = Node engine test (`app/tests/engine.tests.js`), **E** = e2e (`app/tests/dev/e2e_playwright.py`), **A** = axe audit page list. No redesign work has started on any screen, so redesign status is NOT STARTED everywhere; "Status" below is the *existing-feature verification* status.

## Status definitions
`NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `PASS` · `FAIL` · `NEEDS VERIFICATION` (code exists, evidence incomplete)

## Routes / screens

| ID | Screen or workflow | Route / location | Required redesign | Keyboard path tested | Tests | Data integrity checked | Status | Evidence / notes |
|---|---|---|---|---|---|---|---|---|
| SCR-001 | App launch / company selection, create (with sample), restore from file, delete company | `#/` no company → `routes.companies` `ui-pages.js:11` | Consistent startup and company context | No | E | Restore validated (N) | NEEDS VERIFICATION | e2e creates company, restarts browser, data persists |
| SCR-002 | Gateway of VaultBook (home) + sub-menus | `#/gateway[?m=]` `ui-gateway.js` | Grouped keyboard-first navigation | **Yes** (V) | V, E, A | N/A | **PASS** | Lands here; ↑↓/Enter/hot letters/Esc tested; axe 0 |
| SCR-002b | Dashboard (kept) | `#/dashboard` `ui-pages.js:121` | Gateway item | No | E, A | N/A | NEEDS VERIFICATION | Restyled by tokens |
| SCR-002a | Company Snapshot (Company / Payments / Customer tabs, movable panels, gallery) | `#/snapshot?tab=` `ui-snapshot.js:328` | Consistent workspace | Panel grip keyboard move exists | E, A | N/A | NEEDS VERIFICATION | |
| SCR-003 | F11 Company Features window (+ existing Settings › Company/Features tabs) | `ui-config.js` UI.openFeatures | F11 Company Features | **Yes** (F11) | V | **Yes** — feature off keeps classes | **PASS** | vaultbook_ui.py |
| SCR-004 | F12 Configuration window (+ existing App and storage tab) | `ui-config.js` UI.openConfigure | F12 Configuration | **Yes** (F12) | V, E | N/A | **PASS** | density/panel persist after reload; report tools offered |
| SCR-005 | Go To / command bar (Ctrl/⌘+K, Alt+G) | overlay `ui-palette.js` | Go To | Yes | V, E, A | N/A | NEEDS VERIFICATION | Alt+G tested |
| SCR-005c | Top command menus Company/Data/Import/Export/Print (Alt+K/Y/O/X/P) | `index.html` + `ui-keys.js` | Tally-style top menu | **Yes** (Alt+K, ↑↓, Enter) | V | N/A | NEEDS VERIFICATION | Alt+K path tested; others by code review |
| SCR-005d | Function-key panel | `#fkeys` `ui-keys.js` | Contextual actions | Mouse + keys | V | N/A | **PASS** | panel click test, context content test |
| SCR-005a | Keyboard shortcuts panel (?) | modal `ui-shortcuts.js` | Searchable shortcut reference (F1) | ? opens | E | N/A | NEEDS VERIFICATION | |
| SCR-005b | Create menu (Alt+N / New) | modal `ui-core.js:420` | Contextual creation | Alt+N | E | N/A | NEEDS VERIFICATION | Alt+N on macOS unverified |
| SCR-006 | Chart of accounts; account editor; opening balance dialog | `#/accounts` `ui-pages.js:188,241,301` | Keyboard list and editing | No | N, E, A | N (validation, system accounts) | NEEDS VERIFICATION | |
| SCR-006a | Account register | `#/register/<id>` `ui-pages.js:314` | Keyboard rows, filters | Enter applies search | E | N | NEEDS VERIFICATION | |
| SCR-007 | Customers list, contact editor, contact detail | `#/customers`, `#/contact/<id>` `ui-pages.js:392,395,276` | Fast search, create, edit | No | N, E, A | N | NEEDS VERIFICATION | |
| SCR-007a | Customer statement (print) | `#/statement/<id>` `ui-pages.js:422` | Consistent print | No | — | — | NEEDS VERIFICATION | No test found |
| SCR-008 | Vendors list / editor (+1099 vendor fields) | `#/vendors` | Fast search, create, edit | No | E, A | N | NEEDS VERIFICATION | |
| SCR-009 | Invoice, Sales Receipt, Credit Memo entry | `#/txn/new?type=invoice|salesReceipt|creditMemo` `ui-forms.js` | Dedicated entry window | Combo keyboard pick (E) | N, E, A | N (AR, credits) | NEEDS VERIFICATION | |
| SCR-010 | Customer Payment, Customer Refund | `type=payment|customerRefund` | Entry + application | Partial | N, E | N (overpayment, double application) | NEEDS VERIFICATION | |
| SCR-011 | Bill, Vendor Credit | `type=bill|vendorCredit` | Entry + validation | Partial | N, E | N | NEEDS VERIFICATION | |
| SCR-012 | Bill Payment | `type=billPayment` | Entry + application | Partial | N, E | N | NEEDS VERIFICATION | |
| SCR-013 | Expense, Check, Credit Card Credit, Deposit, Transfer | `type=expense|check|ccCredit|deposit|transfer` | Consistent entry windows | Partial | N, E | N (transfer cash neutral) | NEEDS VERIFICATION | |
| SCR-014 | Journal entry (+ reverse) | `type=journal` | Keyboard-first balanced entry | Partial | N, E, A | N (unbalanced rejected, reversal) | NEEDS VERIFICATION | |
| SCR-014a | Transaction view: void dialog, make recurring, audit history drawer, journal drawer, duplicate warning, print | `ui-forms.js:347,495,506,510`, `#/print/<id>` `ui-forms.js:525` | Consistent dialogs | More menu arrow keys | N, E | N (void keeps record) | NEEDS VERIFICATION | |
| SCR-014c | Entry strip (all 14 types): type, No., date+weekday, F4–F9 switch, current balances | `ui-entry.js` | Dedicated entry window | **Yes** (F2, F5, F9, Esc) | V | Ctrl+S post keeps TB balanced | NEEDS VERIFICATION | Tested on invoice/expense; other types by screenshot |
| SCR-014b | Unsaved-changes guard (links, back, window tabs, F-key type switch) | `ui-core.js:221`, `ui-windows.js` | Unsaved-change protection | — | E | Entries preserved | **PASS** (window tabs fixed this session, BUG-002) | 4 new e2e checks pass |
| SCR-015 | Transactions list (filters, export) | `#/transactions?type=` `ui-pages.js:447` | Search, filters, sorting, keyboard rows | Enter applies search | E, A | N/A | NEEDS VERIFICATION | |
| SCR-016 | Bank CSV import, import result | `#/import` `ui-banking.js:10` | Consistent workflow and review | No | N, E, A | N (dup skip, rules) | NEEDS VERIFICATION | |
| SCR-016a | PDF statement import (OCR) | `#/pdfimport` `ui-statement.js:23` | Consistent workflow and review | No | — (sample PDF exists in tests/) | — | NEEDS VERIFICATION | No automated test found |
| SCR-016b | Bank rules list / editor | `#/rules` `ui-banking.js:142,153` | Consistent list/editor | No | N, A | N | NEEDS VERIFICATION | |
| SCR-017 | Bank reconciliation (+undo) | `#/reconcile` `ui-banking.js:170` | Keyboard-friendly reconciliation | No | N, E, A | N (difference 0, lock, undo) | NEEDS VERIFICATION | |
| SCR-018 | Profit & Loss (+ by month/class/customer, comparison, % of income) | `#/report/pnl` `ui-statements.js` | Compact report, drill-down | Esc leaves full screen | N, E, A | N (ties to engine) | NEEDS VERIFICATION | Drill-down to GL (E) |
| SCR-019 | Balance Sheet (+ comparison) | `#/report/bs` | Compact report, drill-down | No | N, E, A | N (balances) | NEEDS VERIFICATION | |
| SCR-020 | Trial Balance | `#/report/tb` `ui-reports.js:136` | Account navigation | No | N, E | N (debits = credits) | NEEDS VERIFICATION | |
| SCR-021 | General Ledger, Journal report, Transaction List by Date | `#/report/gl|journal|txlist` | Ledger navigation | Column resize by arrow keys (E) | N, E, A | N | NEEDS VERIFICATION | BUG-001 flaky scroll |
| SCR-022 | A/R Aging (summary/detail), Customer Balance Summary | `#/report/araging|custbal` | Customer → invoice drill-down | No | E | E (ties to A/R) | NEEDS VERIFICATION | |
| SCR-023 | A/P Aging, Vendor Balance Summary | `#/report/apaging|vendbal` | Vendor → bill drill-down | No | — | — | NEEDS VERIFICATION | |
| SCR-024 | Statement of Cash Flows, Expense Detail, Expenses by Vendor | `#/report/cf|expdetail|expvendor` | Consistent report controls | No | N (cash flow) | N | NEEDS VERIFICATION | |
| SCR-024a | Report center, My reports (saved, rename, delete) | `#/reports` `ui-reports.js:41` | Gateway-style report menu | No | N, E, A | N/A | NEEDS VERIFICATION | |
| SCR-024b | Report Customize drawer, Save as, notes, export menu (Excel/CSV/PDF) | `ui-statements.js` | Standard print/export/customize | Menus | E (Excel/CSV) | Export matches report (E) | NEEDS VERIFICATION | |
| SCR-025 | Classes list / editor | `#/classes` `ui-planning.js:17,26` | Consistent navigation | No | N | N (inactive blocked) | NEEDS VERIFICATION | Feature-gated |
| SCR-025a | Budgets list, new/copy budget, budget editor (spreadsheet grid), adjust %, Budget vs. Actuals | `#/budgets`, `#/budget/<id>`, `#/report/bva` `ui-planning.js` | Consistent configuration | Grid keydown handler exists | N | N | NEEDS VERIFICATION | Feature-gated |
| SCR-026 | Recurring schedules list / edit | `#/recurring` `ui-banking.js:249,276` | Existing feature tested | No | N, A | N (posts once) | NEEDS VERIFICATION | |
| SCR-027 | 1099 setup, 1099 Contractor Summary, 1099 Transaction Detail | `#/1099`, `#/report/t1099|d1099` `ui-planning.js:213` | US-specific workflows retained | No | N | N (threshold, card excluded) | NEEDS VERIFICATION | Feature-gated |
| SCR-028 | Import/export settings tab (accounts/contacts CSV), Custom report builder | `#/settings?tab=data`, `#/builder` `ui-builder.js` | Consistent workflows | No | N (builder) | N | NEEDS VERIFICATION | |
| SCR-029 | Security tab, unlock screen, recovery key, set new password, lock / auto-lock | `#/settings?tab=security` `ui-security.js` | Preserve safeguards | No | N (crypto), A | N (tamper detection) | NEEDS VERIFICATION | |
| SCR-030 | Backup and restore tab, restore dialog, encrypted backup prompt | `#/settings?tab=backup` `ui-pages.js:89,98`, `ui-security.js:152` | Preserve and verify recovery | No | N, E, A | N (checksum, tamper) | NEEDS VERIFICATION | |
| SCR-030a | Data integrity check tab | `#/settings?tab=integrity` | Consistent | No | N (integrity in perf test) | N | NEEDS VERIFICATION | |
| SCR-030b | Audit log tab (search) | `#/settings?tab=audit` | Consistent table | Enter applies search | — | Append-only (N indirectly) | NEEDS VERIFICATION | |
| SCR-031 | Generic dialogs: modal, confirm, prompt, drawer, toasts, empty states | `ui-core.js` | Consistent focus and recovery | Esc closes; focus restored to opener | E, A | N/A | NEEDS VERIFICATION | |
| SCR-032 | Window manager (tabs, taskbar, layout toggle, context menu) | `ui-windows.js` | Fits navigation stack (NAV-001) | Ctrl+Tab/W/T browser-reserved (BUG-004) | E | Unsaved guard fixed (BUG-002) | NEEDS VERIFICATION | A11Y-001 tablist children |
| SCR-033 | Sidebar flyout navigation | `ui-flyout.js` | Replaced/complemented by Gateway + menus | Not verified | E (via helper) | N/A | NEEDS VERIFICATION | BUG-003 |
| SCR-034 | Table tools (resize, hide columns, sticky key column, reset) | `ui-tables.js` | Standard table behavior | Arrow-key resize (E) | E | N/A | NEEDS VERIFICATION | |
| SCR-035 | Import from QuickBooks (drop zone, preview, opening-difference choice, result, history) | `#/migrate` `ui-migrate.js` | New (1.9.0) | Drop zone Enter/Space opens file picker | migrate_ui.py, A | Atomic import + balance compare | PASS | 2026-11-04 |
| SCR-036 | Products and services list + editor | `#/items` `ui-items.js` | New (1.9.0) | Standard form | migrate_ui.py, A | N/A | PASS | |
| SCR-037 | New reports: openinv, unpaidbills, custdetail, venddetail, salescust, salesitem, depdetail, checkdetail, acctlist, custlist, vendlist | `#/report/<key>` `ui-reports.js` | Uses report page | Row cursor as other reports | N, migrate_ui.py | Tie-out lines | PASS | |
| SCR-038 | Statement designer: gallery, editor (row list, row editor, live preview), import/export | `#/designer`, `#/designer/<id>` `ui-designer.js` | New (1.10.0) | Row list ↑↓ Home End, Alt+↑↓ move, Enter edit, Delete; Ctrl+S save | designer_ui.py | Same engine as statements; unmapped-account audit | PASS | 2026-11-04 |
| SCR-039 | PDF page setup dialog (all reports) | `UI.pdfSetup` `ui-core.js` | New (1.10.0) | Standard dialog | designer_ui.py | N/A | PASS | |
| SCR-040 | Report Reconciliation | `#/report/recon` | New (1.10.0) | Report page | Node, designer_ui.py | Tie-out checks | PASS | |
| SCR-041 | Export financial workbook dialog | Reports page button, Ctrl+K; `UI.exportWorkbook` `ui-reports.js` | New (1.11.0) | Standard dialog | workbook_ui.py | Engine-tied workbook | PASS | 2026-11-04 |

## Required additions after repository audit
Done from source for all 25 routes and all `UI.modal/confirm/prompt/drawer` call sites. Remaining for AUD-004: open each dialog at runtime and compare; add any screen discovered at runtime.
