# Implementation Plan and Requirement Traceability — VaultBook

> Product name: **VaultBook** (formerly OfflineBooks US). See DEC-006.

## How to use this plan
- Keep requirement IDs stable.
- Split large tasks into small tasks with explicit dependencies.
- Update status only with evidence.
- Use `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `PASS`, `FAIL`, or `NEEDS VERIFICATION`.
- A `PASS` requires the acceptance criteria and evidence to be recorded.
- Do not remove difficult requirements. Record approved scope changes in `DECISIONS.md`.

## Phase 0 — Audit and baseline

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| AUD-001 | AUDIT | Inspect repository structure and identify app entry points | Main files/modules documented; actual launch method verified | PASS | 2026-10-22. `docs/AUDIT_BASELINE.md` §1. Entry `app/index.html`, launched over file:// by e2e in Chromium. |
| AUD-002 | AUDIT | Map architecture and data storage | Accounting engine, IndexedDB tables/versioning, imports, reports, backup/restore and security mapped | PASS | 2026-10-22. `docs/AUDIT_BASELINE.md` §2: engine, IDB v3 stores, data migrations v1→3, backup, security, prefs mapped from source. |
| AUD-003 | AUDIT | Run existing tests and baseline smoke checks | Actual commands and results recorded; failures listed without hiding them | PASS | 2026-10-22. Node 39/39. E2E crashed as received (stale steps); harness fixed → 186 pass; flaky BUG-001 recorded. axe: 8 issue types. Commands in AUDIT_BASELINE §3. |
| AUD-004 | AUDIT | Inventory all screens and workflows | `SCREEN_INVENTORY.md` contains every discovered screen and feature | NEEDS VERIFICATION | All 25 routes + every modal/confirm/prompt/drawer call site inventoried from source (SCR-001…034). 25 routes visited at runtime by axe audit; dialogs not each opened at runtime yet. |
| AUD-005 | AUDIT | Create requirement traceability map | Every requirement in PRODUCT_SPEC is mapped to implementation tasks and tests | PASS | 2026-10-22. Traceability matrix below maps every PRODUCT_SPEC section to requirement IDs, tasks and existing tests. |

## Phase 0b — Baseline defects found in audit

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| BUG-002 | NAV-001, ENTRY | Window tabs/close/cycle/new-tab must not discard unsaved entries | Unsaved-changes dialog appears; Keep editing keeps entries; background close doesn't interrupt | PASS | 2026-10-22. `app/js/ui-windows.js` routes window actions through `UI.confirmLeave`. 4 new e2e checks: fail on baseline code, pass with fix (3 runs). Node 39/39. Discard path probed manually. |
| BUG-001 | TABLES | GL report: `#main` overflows 2–6 px (double scrollbar), flaky | e2e scroll check passes in 5 consecutive runs | NOT STARTED | Pre-existing; fails ~50% of runs before and after BUG-002 |
| BUG-003 | MENU | Flyout nav: reopen on resting pointer; verify keyboard access to flyout links | Keyboard-only path reaches every sidebar destination | NOT STARTED | Superseded if NAV-003 replaces the flyout |
| BUG-004 | KEY-001 | Remove/replace advertised Ctrl+W/Ctrl+T/Ctrl+Tab (browser-reserved) | No tooltip/help advertises a shortcut that can't fire | PASS | Command menus avoid browser-reserved Alt+E/Alt+F/Alt+D (Export = Alt+X). Tab tooltips no longer advertise Ctrl+W/Ctrl+T (handlers kept for environments that pass them through). |
| BUG-005 | KEY-001 | Reserve `y` (Windows redo) in mnemonics; review d/l/j/o/u/g | Text-editing shortcuts never stolen inside fields | NOT STARTED | Fold into FOUND-005 |
| A11Y-001 | UI | `#window-tabs` tablist contains non-tab children | axe `aria-required-children` = 0 | PASS | 2026-10-22 session 2. `#window-tabs` is now a navigation landmark (holds tabs + close buttons). axe aria-required-children 0. |
| A11Y-002 | UI | Color contrast on New button, phone dashboard button, dark tab titles | axe `color-contrast` = 0 | PASS | 2026-10-22 session 2. Contrast fixed through tokens; axe color-contrast 0. |
| DOC-001 | AUDIT | Update stale `app/docs/SCHEMA.txt` (v3) and `app/README.txt` (1.7.0, 39 checks) | Docs match code | IN PROGRESS | 2026-11-05: SCHEMA.txt updated to data v5 / IndexedDB v4; README header still old |
| BRAND-001 | ARCH-002 | Rename visible product name to VaultBook (title, sidebar brand, logo mark, About, README/guide, backup filename) **without** changing storage identifiers | All visible "OfflineBooks" strings replaced; existing DBs, prefs and backups still open; backup restore across versions tested | PASS | 2026-10-22 session 2. Visible name VaultBook (title, logo mark, brand, home screen, About, report footer, recovery-key file, messages, backup file name `VaultBook_*.json`). Storage ids unchanged (DEC-006); backups still `OfflineBooksUS-Backup`. Node backup tests 39/39; e2e restore passes. |

## Phase 1 — Foundations

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| FOUND-001 | ARCH-001 | Establish safe version-control/checkpoint workflow | Current state is recoverable; changes are reviewable | NEEDS VERIFICATION | Git repo created; baseline commit = unmodified zip. Verified in cloud workspace. On the Mac folder, git needs delete permission for lock files (see PROJECT_STATE risks). |
| FOUND-002 | ARCH-002 | Define reusable visual tokens/components | Typography, spacing, colors, borders, focus states and density are consistent | PASS | 2026-10-22 session 2. `app/css/vault.css` tokens (light/dark), density, focus/selection states; axe 0 issues on 28 pages × light/dark × desktop/phone. |
| FOUND-003 | NAV-001 | Implement navigation state/stack | Back restores previous screen state in tested workflows | NEEDS VERIFICATION | 2026-10-22 session 2. Esc/Back uses browser history + per-screen memory of scroll and selected row (`ui-keys.js`). Tested: report→drill-down→Esc restores row; register→open→Esc restores row (vaultbook_ui.py). Filters live in the URL so they return too. No separate stack object. |
| FOUND-004 | KEY-001 | Audit current shortcut behavior and conflicts | Existing shortcuts documented; conflicts and platform risks recorded | PASS | 2026-10-22. `docs/AUDIT_BASELINE.md` §5: every keydown handler (18) audited, conflicts BUG-004/005, macOS/browser F-key risks recorded. Real Windows/macOS hardware not tested. |
| FOUND-005 | KEY-002 | Implement centralized shortcut registry | Context-aware actions, help reference, focus safeguards, and tests work | PASS | 2026-10-22 session 2. `app/js/ui-keys.js` registry drives keys, panel and F1 reference; typing-safe (Alt+letter ignored while typing on Mac, Esc in a field only leaves it). 40/40 vaultbook_ui.py checks incl. "letters type normally inside fields". |
| FOUND-006 | UI-001 | Implement reusable workspace/window shell | Header, content, contextual actions, focus, close/back behavior are reusable | PASS | 2026-10-22 session 2. Frame on every screen: command bar, title bar (sticky page head), work area + function-key panel, Esc back. |

## Phase 2 — Gateway and navigation

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| NAV-002 | GATEWAY | Redesign Gateway/home screen | Company context and grouped real destinations are present and keyboard usable | PASS | 2026-10-22 session 2. `#/gateway` is the home: company, period, today, last entry, alerts, recent entries; grouped menu MASTERS/TRANSACTIONS/BANKING/REPORTS/COMPANY. Tests: lands on Gateway, focus on menu, unique hot letters. |
| NAV-003 | MENU | Implement hierarchical menus | Arrow/Enter/Escape behavior works; no dead menu items | PASS | 2026-10-22 session 2. Sub-menus Create/Alter/Vouchers/Banking/Display More Reports; ↑↓ Home End Enter, hot letters, Esc to parent. Every item opens an existing screen/dialog (feature-gated items hidden). |
| NAV-004 | ACTIONS | Implement contextual action panel | Actions change by context and invoke real functions | PASS | 2026-10-22 session 2. Right function-key panel rebuilt per screen from the registry (This screen / Create / Company); mouse-clickable; hide/show via F12. |
| NAV-005 | SEARCH | Upgrade command palette / Go To | Search opens correct supported destination, record, report or action | NEEDS VERIFICATION | Existing command bar (Ctrl/⌘+K) now also on Alt+G and the command-bar "G: Go To"; Gateway added as a destination. Search coverage itself unchanged from 1.7.0. |
| NAV-006 | HISTORY | Preserve navigation context | Back returns to previous screen and preserves relevant filters/selection | NEEDS VERIFICATION | Selected row and scroll restored on Esc/back (tested); report period/filters return via URL. Not tested for every screen. |

## Phase 3 — Company features and configuration

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| CFG-001 | F11 | Implement F11 Company Features | Supported settings work, persist, validate, and do not delete data when disabled | PASS | 2026-10-22 session 2. F11 window: basis, fiscal year, closing date, terms, 1099, classes, budgets (+ security/audit status links). Test: classes on → menus appear; off → class data kept. |
| CFG-002 | F12 | Implement context-sensitive F12 Configuration | Screen-specific settings work and persist | PASS | 2026-10-22 session 2. F12 window: appearance, density, function-key panel, sidebar, window layout; on reports also Customize/Columns/Expand/Collapse/View. Test: density + panel persist across reload; report tools offered. |
| CFG-003 | CFG | Add settings validation/help | Every visible setting has a real effect or is omitted | PASS | Every F11/F12 control writes an existing setting or presses an existing tool; nothing decorative. |

## Phase 4 — Entry windows and masters

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| ENTRY-001 | ENTRY | Build reusable entry-window framework | Predictable focus, validation, unsaved-change handling and save lifecycle work | NEEDS VERIFICATION | 2026-10-22 session 2. Entry strip (type, No., date + weekday, F4–F9 switch), current balances, F2 date, Esc-leave-field, unsaved guard on type switch (tested). Line-grid keyboard model unchanged from 1.7.0. |
| ENTRY-002 | ENTRY | Upgrade journal entry | Balanced posting rules preserved; create/edit/reopen tested | NOT STARTED | |
| ENTRY-003 | ENTRY | Upgrade invoice/sales workflow | Save, validation, customer selection and reopen tested | PASS | Invoice: QuickBooks-layout screen in VaultBook theme (INV-004), qbinvoice_ui.py 22/22, e2e 191/191. Sales receipt/credit memo still use the standard form |
| ENTRY-004 | ENTRY | Upgrade bills/purchases workflow | Save, validation, vendor selection and reopen tested | NOT STARTED | |
| ENTRY-005 | ENTRY | Upgrade receipts/payments/deposits/transfers | Each supported type has appropriate fields and tests | NOT STARTED | |
| ENTRY-006 | ENTRY | Upgrade master creation/selection | Accounts, customers, vendors and other supported masters work by keyboard | NOT STARTED | |
| ENTRY-007 | ENTRY | Upgrade remaining transaction types | Every discovered type is mapped, upgraded, and tested | NOT STARTED | |

## Phase 5 — Registers and reports

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| REPORT-001 | TABLES | Standardize accounting tables/registers | Keyboard row navigation, sorting, filters and selection work | NEEDS VERIFICATION | 2026-10-22 session 2. Row cursor ↑↓ PgUp PgDn + Enter open on registers and reports; dense rows; tested on Trial Balance and Transactions. Sorting/filters unchanged. |
| REPORT-002 | REPORTS | Upgrade Profit & Loss | Period controls, totals, drill-down and export tested | NOT STARTED | |
| REPORT-003 | REPORTS | Upgrade Balance Sheet and Trial Balance | Values reconcile to accounting layer; drill-down works | NOT STARTED | |
| REPORT-004 | REPORTS | Upgrade General Ledger and transaction detail | Correct source transactions open; back preserves report state | NOT STARTED | |
| REPORT-005 | REPORTS | Upgrade A/R, A/P and Cash Flow reports | Supported workflows and values are verified | NOT STARTED | |
| REPORT-006 | REPORTS | Upgrade budgets, 1099 and custom reports | Existing supported features remain functional | NOT STARTED | |
| REPORT-007 | REPORTS | Standardize print/export/customization | Output matches filters and displayed report data | NEEDS VERIFICATION | 2026-11-04: statements/designer export the on-screen model (collapsed groups, titles, number format, header/footer); classic reports export their matrix to PDF/Excel. Real Excel/printer not tested. |

## Phase 6 — Remaining modules and polish

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| MOD-001 | MODULES | Upgrade banking and reconciliation | Existing reconciliation logic preserved and tested | NOT STARTED | |
| MOD-002 | MODULES | Upgrade imports and import review | Import validation and data mapping remain correct | NOT STARTED | |
| MOD-003 | MODULES | Upgrade budgets, classes and recurring transactions | Existing features work end to end | NOT STARTED | |
| MOD-004 | MODULES | Upgrade 1099 and other US accounting modules | Supported functionality and reports are verified | NOT STARTED | |
| MOD-005 | MODULES | Upgrade settings, security, backup and restore | Data recovery and security behavior pass tests | NOT STARTED | |
| MOD-006 | UI | Audit every screen for consistency/accessibility | All inventory items have status and evidence | NEEDS VERIFICATION | Design tokens apply to all screens; 43 screenshots reviewed in `reference-ui/after/`; axe 0 issues. Per-screen keyboard tests not complete. |

## Phase 6b — QuickBooks migration (user request 2026-11-04)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| MIG-001 | MIGRATE | Read QuickBooks Desktop exports (IIF lists/TRNS, GL CSV, address TXT, P&L/BS PDF) | Files recognised; transactions rebuilt balanced | PASS | Node tests "QuickBooks import: …" (synthetic fixtures); real export: 470 transactions, 0 plan errors |
| MIG-002 | MIGRATE | Plan + atomic import into an empty company | All-or-nothing; refuses companies with transactions | PASS | Node "all-or-nothing" test; migrate_ui.py "cannot be imported into twice" |
| MIG-003 | MIGRATE | Verify after import (balances vs QuickBooks, PDF lines, integrity) | Result screen states each check | PASS | migrate_ui.py 38/38; real export: 66/66 balances equal, P&L 10 lines and BS 6 lines match, integrity clean |
| MIG-004 | MIGRATE | Migration screen + entry points (Gateway, Alt+O, Settings, sidebar, palette, new-company option) | Reachable and keyboard accessible | PASS | migrate_ui.py; axe 0 issue types incl. #/migrate |
| ITEM-001 | ITEMS | Products and services list, editor, line column | Create/edit; line fills account/description/price | PASS | Node "Items" test; migrate_ui.py item checks |
| CONTACT-001 | CONTACTS | Extended contact details kept and editable | Fields survive edit/import | NEEDS VERIFICATION | Saved via `S.CONTACT_EXTRA`; editor "More details" not covered by an automated UI test |
| REPORT-008 | REPORTS | Open Invoices / Unpaid Bills Detail in Reports (not only dashboard) | Tie to A/R / A/P | PASS | Node report test; migrate_ui.py; real export ties to A/R $16,070,877.59 |
| REPORT-009 | REPORTS | Customer/Vendor Balance Detail, Sales by Customer/Item, Deposit/Check Detail, Account/Customer/Vendor lists | Values reconcile to ledger | PASS | Node report test (sales by customer = total income; detail lines add up) |
| MIG-005 | MIGRATE | Inventory quantities, sales tax items, estimates/sales orders | Decide scope | NOT STARTED | Imported as items/skipped with warnings; quantities on hand not tracked |

## Phase 8 — Financial reporting upgrade (session 4, see `docs/REPORTING_PLAN.md`)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| FR-001 | REPORTS | MTD / QTD compare columns on P&L | MTD/QTD equal a P&L for the month / fiscal quarter to date | PASS | Node "MTD and QTD columns" (fiscal year July); designer_ui.py headers |
| FR-002 | REPORTS, QA-003 | Report reconciliation (`R.reconcile`, report `recon`) | TB, ledger, BS (two engines), P&L vs ledger, cash flow, A/R, A/P tie on both bases; tampering is caught | PASS | Node "Reconciliation…"; designer_ui.py "every check ties" on sample data |
| FR-003 | REPORTS | Shared model + Excel engine (formulas, merges, freeze, print titles, fit width, styles) | Formula results equal engine values in an independent spreadsheet | PASS | Node evaluator; LibreOffice recalculation: 82 statement + 100 designer formulas, 0 differences; e2e Excel check (data_only + formulas + freeze); openpyxl opens all files |
| FR-004 | REPORTS | PDF engine (pagination, repeating headings, page X of Y, paper sizes, orientation) | Valid PDF; every screen figure present as the same text | PASS | Node checks (xref offsets, figures, 300-line report paginates, Legal/custom sizes); `qpdf --check` clean; pypdf strict; designer_ui.py PDF downloads from statement, Trial Balance (Legal landscape) and designer |
| FR-005 | REPORTS | Template engine: JSON + schema, account mapping, formulas, validation, unmapped/duplicate audit, conditional styles, import/export | Validation catches syntax/unknown/circular/duplicate/scope errors; template totals equal the statement engine | PASS | Node "Designer: …" (3 tests); fromJson rejects bad files |
| FR-006 | REPORTS, UI | Statement designer screen (`#/designer`) | Add/edit/drag/keyboard-move rows, live preview, drill-down, save/reload, My reports, Excel/PDF, export/import, unsaved guard | PASS | designer_ui.py 39/39 incl. accessible names and unique ids. axe-core NOT RUN (could not be downloaded in this sandbox) |
| FR-007 | REPORTS | Column drag-and-drop, PDF logo/images, cross-column formulas, consolidation | Decide scope | NOT STARTED | Named in REPORTING_PLAN §4 as not in this pass |

## Phase 9 — Interactive financial workbook (session 5)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| XW-001 | REPORTS, EXPORT | Excel writer: links, names, tables, filters, validation, conditional formats, outlines, charts, protection, compression | Files open in LibreOffice/openpyxl/SheetJS; all XML parts well-formed | PASS | workbook_check.py (28 parts well-formed; SheetJS reads 14 sheets, formulas, names); zip `testzip` clean |
| XW-002 | REPORTS | Workbook builder (14 sheets) on one data sheet with SUMIFS | Cached values equal the engine; LibreOffice recalculation equals cached values | PASS | Node "Workbook: every exported figure…" (accrual + cash, GL closings); workbook_check.py: 759–858 formulas per file, 0 differences |
| XW-003 | REPORTS | Date filters recalculate in Excel | After changing From/To in the file, P&L, BS, TB, CF equal the engine for that period | PASS | workbook_check.py: 6 changed periods across calendar/July fiscal years, accrual/cash, incl. a period after year end (RE rollover) |
| XW-004 | REPORTS | Drill-down links and back links | Every hyperlink lands on an existing, non-empty row | PASS | workbook_check.py (all links in 3 files) |
| XW-005 | UI | Export Financial Workbook dialog (period, basis, sheets, protection) per company | Downloads; options honoured; companies never mix | PASS | workbook_ui.py 18/18 |
| XW-006 | PERF | Large companies and row limits | 50,000 lines export in seconds; clear refusal above Excel's limit | PASS | 20,000 transactions: 3.9 s, 7.3 MB (94.6 MB uncompressed before); Node row-limit test |
| XW-007 | QA | Microsoft Excel (Windows/macOS) opening, recalculation and link clicks | Real Excel | NEEDS VERIFICATION | Not available in the sandbox |

## Phase 10 — Invoices: classic print layout, QuickBooks-style entry, .iif export (session 6)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| INV-001 | PRINT | Classic invoice print/PDF layout (user sample) | Box lines, text positions, fonts and sizes match the sample PDF | PASS | pdfplumber vs sample: 40/40 box lines, text starts 0.00 pt, same fonts; right-edge spacing ≤ 5.75 pt (sample's print driver); invoice_ui.py 17/17 |
| INV-002 | PRINT | Optional company logo (none by default) | Upload, scale ≤ 1200 px, print in SVG and PDF, remove | PASS | invoice_ui.py; Node logo validation test |
| INV-003 | EXPORT | Invoices to QuickBooks Desktop .iif (many or one) | Valid IIF (CRLF, Windows-1252) that VaultBook's QuickBooks importer reads back with equal totals | PASS | Node IIF round-trip test; invoice_ui.py dialog checks |
| INV-004 | UI | Invoice entry screen laid out like QuickBooks Desktop Create Invoices | Toolbar, CUSTOMER:JOB bar, header, grid, customer message (< Add New >), totals, Save & Close / Save & New / Revert all work; nothing decorative | PASS | qbinvoice_ui.py 22/22; e2e 191/191 |
| INV-005 | QA | Import the .iif into real QuickBooks Desktop | Real QuickBooks | NEEDS VERIFICATION | Not available in the sandbox |

## Phase 11 — ER-design audit follow-up (session 7, 1.13.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| ERD-001 | AUDIT | Audit VaultBook against the user's ER design | Every design area marked Have / Partial / Missing with a plan | PASS | `docs/ERD_AUDIT.md` |
| ERD-002 | TAX | Sales tax rates, taxable lines, posting, print, .iif, liability report, exempt customers | Exact-cent tax; balances; report ties to Sales Tax Payable; .iif round trip | PASS | Node tests (3 new), salestax_ui.py 30/30 |
| ERD-003 | DOCS | Estimates and purchase orders (non-posting), convert, close/reopen | No ledger effect; convert closes; void reopens | PASS | Node test; salestax_ui.py |
| ERD-004 | AUDIT | Hash-chained audit trail with verification | Edit/deletion detected; integrity check reports it | PASS | Node test; salestax_ui.py |
| ERD-005 | CLOSE | Closing-date history and password | Change refused without password; history kept | PASS | Node test; salestax_ui.py |
| ERD-006 | AR | Credit limit warning | Warns above limit, never blocks | PASS | salestax_ui.py |
| ERD-007 | QA | .iif with sales tax in real QuickBooks Desktop | Real QuickBooks | NEEDS VERIFICATION | Not available in the sandbox |
| ERD-008 | INV | Inventory quantities, average cost, automatic COGS (ITEM_STOCK, COST_LAYER) | Decide scope with the user | NOT STARTED | Largest remaining gap |
| ERD-009 | PARTY | Customer:Job, early-payment discount terms, price levels | Decide scope | NOT STARTED | |
| ERD-010 | BANK | Attachments, check printing, NACHA / positive pay, multi-user roles | Decide scope | NOT STARTED | |

## Phase 12 — US features batch 1 (1.14.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| US-001 | BANK | Make Deposits from Undeposited Funds | Grouped deposit; links kept on edit; deposited payments protected | PASS | Node test; business_ui.py |
| US-002 | BANK | Check printing (print later, voucher layout, numbering, alignment) | Preview/PDF correct; numbers recorded; ledger unchanged | PASS | Node test; business_ui.py |
| US-003 | 1099 | W-9 flag, recipient copies, 1096 totals, IRIS data CSV | Rows/CSV/PDF correct; problems listed | PASS | Node test; business_ui.py; IRS accepts only its own template (documented) |
| US-004 | AR | Bad debt write-off | Credit memo to Bad Debt applied | PASS | Node test; business_ui.py |
| US-005 | AR | Finance charges | APR × days/365, minimum, grace; invoices created | PASS | Node test; business_ui.py |
| US-006 | QA | Print checks on real check stock | Real printer | NEEDS VERIFICATION | |

## Phase 13 — US features batch 2 (1.15.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| US-007 | INV | Perpetual inventory at average cost (purchases, COGS on sale, returns, adjustments, opening qty, reorder) | Valuation ties to Inventory Asset; splits rebuild exactly | PASS | Node test; inventory_ui.py |
| US-008 | INV | Inventory Valuation Summary, Inventory Stock Status | Totals correct; reorder flags | PASS | Node test; inventory_ui.py |
| US-009 | FA | Fixed asset register; SL / DDB / MACRS schedules; depreciation entries; register report | Schedules sum exactly; nothing posted twice | PASS | Node test; inventory_ui.py |
| US-010 | FA | Disposal gain/loss entry | Decide scope | NOT STARTED | Disposal stops depreciation; sale recorded by journal entry |

## Phase 14 — US features batch 3 (1.16.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| US-011 | DOCS | Attachments on transactions (store, size limit, tombstones, backups) | Add/open/remove; in backups | PASS | Node test; projects_ui.py |
| US-012 | PARTY | Customer:Job (parent customer, status, labels, P&L by Job) | No cycles; labels everywhere | PASS | Node test; projects_ui.py |
| US-013 | AR | Billable costs re-billed on invoices; Unbilled Costs by Job | Billed once; void reopens; guarded edits | PASS | Node test; projects_ui.py |
| US-014 | TAX | Tax-line mapping (1040 Sch C, 1120-S, 1065, 1120), suggestions, Income Tax Summary, CSV | Totals by line; unmapped listed | PASS | Node test; projects_ui.py; line numbers per 2025 forms (verify yearly) |

## Phase 15 — US features batch 4 (1.17.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| US-015 | SALES | Sales orders (non-posting, convert to invoice) | No ledger effect; converts | PASS | Node test; sales_ui.py |
| US-016 | SALES | Progress invoicing (rest / % per line), partial PO billing | Limits per line; closes when full; void reopens | PASS | Node test; sales_ui.py |
| US-017 | SALES | Batch invoicing | One invoice per customer with their terms/tax/prices | PASS | Node test; sales_ui.py |
| US-018 | AR | Customer deposits / retainers | Held as liability; applied on invoice; zero-total prepaid invoice | PASS | Node test; sales_ui.py |
| US-019 | SALES | Price levels (percent or per item) | Prices on lines and batch invoices | PASS | Node test; sales_ui.py |

## Phase 16 — US features batch 5 (1.18.0)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| US-020 | TAX | Combined rates by agency (taxParts), return per agency, Pay Sales Tax, exemption certificates | Exact split; due per agency; liability cleared | PASS | Node test; taxreports_ui.py |
| US-021 | REPORTS | A/R Collections, Missing Checks, Voided/Changed, Cash Flow Forecast | Correct figures | PASS | Node test; taxreports_ui.py |
| US-022 | QA | Whole US feature round (1.14–1.18) | All suites pass | PASS | Node 79/79; 13 browser suites pass; `docs/US_FEATURE_AUDIT.md` |

## Phase 17 — Design polish (1.18.1)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-030 | UI | Impeccable audit + polish of main screens | 0 sub-11px functional text; no >1px side stripes; one active nav group | Done | docs/DESIGN_AUDIT.md: 288 → 0 undersized, nested cards 3 → 1 |

## Phase 18 — Entry-screen density (1.18.2)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-031 | UI | Remove repeated header row on invoice-style forms; compact toolbar; fix squeezed tab strip, truncated Billable, stray Print later | One band of chrome above Customer:Job; no truncated headers | Done | screenshots in session; vaultbook_ui strip checks updated |

## Phase 19 — Invoice ribbon (1.18.3)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-032 | UI | Ribbon toolbar on invoice-style forms; foldable function-key panel | All More actions visible; panel hide/show persists | Done | e2e checks no More on invoice; all suites green |

## Phase 20 — Desktop reports, item search, Esc (1.18.4)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-033 | RPT/UI | Desktop layout for BS/P&L, item type-ahead, Esc leaves entry with keyboard dialog, Home/Close controls | All suites green; vaultbook_ui Esc checks | Done | screenshots in session |

## Phase 21 — Dialog letters (1.18.5)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-034 | UI | Underline dialog access letters, drop hint line | K/D/S underlined | Done | screenshot |

## Phase 22 — Flat sheets everywhere (1.18.6)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-035 | UI | Remove grey margins and framed boxes from all screens | No grey around content on 13 checked screens | Done | contact sheet screenshots |

## Phase 23 — Drill to transaction detail (1.18.7)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| RPT-040 | RPT | Transaction Detail By Account; drill from totals; no gridlines; hover/keyboard open | Detail totals tie to statement | Done | tests/dev/txdetail_ui.py 9/9 |

## Phase 24 — Single highlight (1.18.8)

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| UX-036 | UI | Mouse hover and keyboard cursor share one highlight | Never two rows lit | Done | txdetail_ui 10/10 |

## Phase 6v — 1.19.0 CPA audit fixes (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CPA-01…25 | All tasks in CPA_AUDIT_FIX_PROMPT.md | Done | tests/cpa.tests.js (30 named tests) |
| UX-1.19 | Dashboard chart drill-down | Done | txdetail_ui.py (3 new checks) |

## Phase 6w — 1.20.0 Bank feed (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-01…08 | Import defects from the bank UX audit | Done | tests/bankfeed.tests.js |
| BF-10…17 | Bank feed inbox, matching, undo, suggestions, backup | Done | tests/bankfeed.tests.js, tests/dev/bankfeed_ui.py |
| Next | Rules v2, grouped deposits, reconcile adjustments and report | Planned | audit doc phases 3–5 |

## Phase 6x — 1.21.0 Bank feed export to QuickBooks (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-20/21 | .iif and QBO CSV export of posted bank lines, tracking | Done | tests/bankfeed.tests.js, tests/dev/bankfeed_ui.py |

## Phase 6x — 1.22.0 TallyPrime-style keys, registers, Reclassify (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| TP-01 | Typed date shorthand (U.smartDate), F2 date / Alt+F2 period | Done | tests/tally.tests.js, tests/dev/tally_ui.py |
| TP-02/03 | Sales / Purchase / Bank registers (js/registers.js) | Done | tests/tally.tests.js, tests/dev/tally_ui.py |
| TP-04/05 | Reclassify Transactions (js/reclass.js, js/ui-reclass.js) | Done | tests/tally.tests.js, tests/dev/tally_ui.py |
| UI | Report button panel, one P&L/BS, Gateway header, company list keys, row cursor | Done | tests/dev/tally_ui.py, vaultbook_ui.py |

## Phase 6x — 1.23.0 Bank rules v2, grouped matches, already-in-books, reconcile (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BP-01…03 | Rules v2: conditions, accounts, splits, auto-add, preview | Done | tests/bankplus.tests.js, tests/dev/bankplus_ui.py |
| BP-04/05 | Deposit of Undeposited Funds payments; group match of several entries | Done | tests/bankplus.tests.js, tests/dev/bankplus_ui.py |
| BP-06/07 | Already in the books on import (preview, auto-match, undo) | Done | tests/bankplus.tests.js, tests/dev/bankfeed_ui.py, bankplus_ui.py |
| BP-08/09 | Reconcile adjustment, frozen report, find | Done | tests/bankplus.tests.js, tests/dev/bankplus_ui.py |

## Phase 6y — 1.24.0 QuickBooks Online Excel import, company from files (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QO-00 | Worksheet → rows; constant formulas read as numbers | Done | tests/qbo.tests.js |
| QO-01/02 | Recognise QBO reports; Journal → transactions; types from Balance Sheet + P&L | Done | tests/qbo.tests.js |
| QO-03 | Full import equals the Trial Balance; contacts; unique numbers | Done | tests/qbo.tests.js, tests/dev/qbo_ui.py |
| QO-04 | General Ledger fallback (headings, sub-accounts) | Done | tests/qbo.tests.js |
| QO-05/06 | Missing/partial reports explained; Account List; day-first dates | Done | tests/qbo.tests.js |
| QO-UI | Create a company from files (Alt+Q); Excel on the import screen | Done | tests/dev/qbo_ui.py (15) |

## Phase 6z — 1.25.0 Studio look, home widgets, + New menu (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| ST-01/02 | Home widget numbers (R.home): 30-day P&L and change, top expenses, invoices, bills, banks | Done | tests/studio.tests.js |
| ST-UI | Light top bar (search, period, + New), home tabs, Business overview, + New menu, Banking badge, Categorized tab, dark mode | Done | tests/dev/studio_ui.py (26) |
| ST-CSS | css/studio.css restyles every screen; all 25 suites re-run | Done | tests/dev/*.py |

## Phase 6z.1 — 1.25.1 register graphs, folding filters, shorter Gateway (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| ST-UI2 | Register month graph, folding options panel, shorter Gateway with Company menu, smaller year chart, no backup banner, no key hints on tabs | Done | tests/dev/studio_ui.py (40), migrate_ui (38) |

## Phase 6z.2 — 1.26.0 QuickBooks Online patterns (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-22 | Bank line note and corrected date before posting (updateBankLine) | Done | tests/bankfeed.tests.js |
| ST-03 | Report chart series (R.statementChart) | Done | tests/studio.tests.js |
| Q26-UI | Bookmarks, gear menu, compact side menu, Ctrl+Alt keys, Posted tab, report bar + chart + Classic layout, home Customize/Privacy, customer hub tabs, on-form preview | Done | tests/dev/qbo26_ui.py (29) |
| Q26-REG | All 22 browser suites re-run green | Done | tests/dev/*.py |

## Phase 6z.3 — 1.26.1 one deposit, several invoices (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-23 | Multi-invoice suggestion (name without spaces, invoice numbers, subsets), bankOpenDocs, part payments in postBankLine 'open' | Done | tests/bankfeed.tests.js |
| Q26-MATCH | Manual invoice picker in Find match | Done | tests/dev/qbo26_ui.py (37) |

## Phase 6z.4 — 1.26.2 one invoice, several deposits (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-24 | Split payments across For review lines (same named contact, 60 days, invoice dated before) | Done | tests/bankfeed.tests.js |
| BF-25 | Invoice number in bank text decides; oldest first on ties, no automatic match | Done | tests/bankfeed.tests.js |
| Q26-SPLIT | Split payment in Find match, then the rest | Done | tests/dev/qbo26_ui.py (40) |

## Phase 6z.5 — 1.27.0 Find (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| FD-01..04 | Find engine: conditions, match all/any, line descriptions, where-matched, parse plain words and field:value, search everything | Done | tests/find.tests.js |
| FD-UI | Find screen (All results / Simple / Advanced), Ctrl+F, command bar row, saved searches, export | Done | tests/dev/find_ui.py (21) |

## Phase 6z.6 — 1.27.1 bank feed fix (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-UI-POSTED | Posted/Excluded row click opens the transaction; no review panel outside For review | Done | tests/dev/qbo26_ui.py (42) |

## Phase 6z.7 — 1.27.2 reconciliation report (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BP-20 | Reconciliation Detail/Summary model (sections, counts, running balances, cleared/register balance, PDF text) | Done | tests/bankplus.tests.js |
| RR-UI | Screen, Download PDF, Excel, CSV, Summary view | Done | tests/dev/bankplus_ui.py (19) |

## Phase 6z.8 — 1.27.3 payments to QuickBooks Desktop (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-26 | IIF PAYMENT/BILLPMT with applied invoices in memo; paymentList CSV | Done | tests/bankfeed.tests.js |
| BF-XPAY-UI | Export panel default, list, already-exported list | Done | tests/dev/qbo26_ui.py (46) |

## Phase 6z.9 — 1.28.0 QuickBooks Desktop connector (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| BF-27 | connectorBatch: one entry per customer payment, invoices and amounts as strings, period respected, bill payments counted | Done | tests/bankfeed.tests.js |
| QBC-UI | Export panel button downloads the batch | Done | tests/dev/qbo26_ui.py (47) |
| QBC-PS | tools/VaultBook-QB-Connector.ps1 check/apply, duplicate guard, result csv | Written; not run here (no Windows/QuickBooks) | user's first test: DM RADS 55,830.27 → invoice 1243 |

## Phase 6z.10 — 1.29.0 Invoice Payment Days MIS report (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| MIS-01..04 | paydays.js engine: per invoice, per customer, per payment; filters; fields and matrix | Done | tests/mis.tests.js |
| MIS-UI | Report screen, glance strip, drill to customer, Fields chooser, exports | Done | tests/dev/mis_ui.py (12) |

## Phase 6z.11 — 1.29.1 Invoice Payment Days drill-down (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| MIS-05 | One-level drill (customer → invoices) with payment details on each invoice row | Done | tests/mis.tests.js |
| MIS-06 | Excel row groups from a drill-down matrix (outline level, summary above) | Done | tests/mis.tests.js, tests/dev/mis_ui.py (19) |

## Phase 6z.12 — 1.29.2 income accounts per invoice (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| MIS-07 | incomeText, incomeCount, inc:<account> fields summed by customer and total | Done | tests/mis.tests.js, tests/dev/mis_ui.py (22) |

## Future version — Payroll from paystubs with local AI (planned, not started)
Agreed with the user 2026-11-12. Build only after the QuickBooks Desktop send screen.
| ID | Task | Status | Notes |
|---|---|---|---|
| PAY-LAB | Paystub Lab: separate offline test page; load sample paystubs (PDF text with positions, scans), run readers side by side, score every field (gross, each tax, deductions, net, current vs YTD) against the user's correct figures | Planned | Needs 3–5 anonymised layouts from the user incl. one paragraph-style and one scan, with correct figures |
| PAY-READ | Layout reader: rebuild rows/columns from PDF text positions; paragraphs kept as sentences | Planned | Engine, no AI |
| PAY-AI | Optional local models in a Web Worker, loaded from a user-picked file and kept in IndexedDB: small text LLM (Qwen 0.5–0.6B class, ~300 MB) maps labels and picks current vs YTD; vision models for structure/scans (Granite-Docling 258M, Florence-2-base 0.23B OCR with regions; SmolVLM2 as a cross-check) | Planned | Models only suggest. Every number must exist in the PDF text (or two readers must agree on scans); never posts |
| PAY-CHECK | Checks: gross − deductions = net per employee; sections add up; YTD = last YTD + current; totals tie to payroll register and bank feed | Planned | Fail → nothing posted |
| PAY-MAP | Per-company layout + label mapping learned after the user confirms the first stub; later months run without AI | Planned | Standard categories: gross wages, federal/state W/H, employee SS/Medicare, deductions (401k, health), employer SS/Medicare/FUTA/SUTA, employer benefits, net pay |
| PAY-JE | Gross-up journal entry per pay date or month (combined or per employee): Dr wages, payroll tax expense, employer benefits; Cr cash/clearing (net), payroll liabilities by type; liabilities cleared by bank-feed matches | Planned | Accounts chosen once per company; user reviews before posting via saveTransaction |
| PAY-PRIV | Never store SSN or bank account numbers from paystubs | Planned | |
| AI-EMB | Small embedding model (~25–35 MB, e.g. BGE-small/MiniLM) for bank categorization similarity and smarter Find | Planned | Ties into Engine Lab |
Constraints to resolve first: AGENTS.md "no dependencies" (vendor the runtime, MIT: wllama / Transformers.js); VaultBook opens from file:// (module imports, secure context, threads need COOP/COEP — may need a small local launcher); CPU-only speed.

## Phase 6z.13 — 1.30.0 Send to QuickBooks Desktop (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QS-01..03 | qbsend.js: sendList filters, batch v2 (invoices + payments), applyResult / company.qbSent | Done | tests/qbsend.tests.js |
| QS-UI | #/qbsend screen, menu, batch download, load result, badges, status filter | Done | tests/dev/qbsend_ui.py (16) |
| QS-PS | tools/VaultBook-QB-Send.ps1 + Send to QuickBooks.cmd / Check only .cmd | Written, reviewed by a second reader, not run here | user's first run |

## Future version — QuickBooks Desktop two-way gap transfer (planned, agreed 2026-11-12)
Workflow: Import from QuickBooks → do the books in VaultBook → Read QuickBooks (snapshot) → Show the gap month by month → Send the gap → Tie out.
| ID | Task | Notes |
|---|---|---|
| GAP-READ | Script reads QuickBooks: transactions per month (all types), trial balance per month end, lists; saves a snapshot .json | Read-only; VaultBook matches imported txns by QuickBooks TxnID, sent ones by VaultBook id, hand-typed by type+date+number+amount (flag close calls) |
| GAP-UI | Month-state screen (Done/ties, Not in QuickBooks, Partly, Differs); tick months in any order; cross-month needs (e.g. a Sep invoice a Nov payment pays) offered | Pre-cut-over months may go as monthly summary journals + open items |
| GAP-SEND | Batch covers bills, bill payments, checks, expenses, card charges, deposits, transfers, journals, credits; date order; dup-safe; tie-out read after | |
| GAP-ONE | One menu script (Read / Send / Read-send-read / Check only), Y/N questions only, "yes to all"; never searches Downloads — always asks for the file; results saved beside it | Replaces the 1.30 launchers |

## Phase 6z.14 — 1.31.0 Read QuickBooks + month gap (done; GAP-READ/GAP-UI first cut)
| ID | Task | Status | Evidence |
|---|---|---|---|
| SY-01..04 | qbsync.js: compare (key / fields), months and states, gap with cross-month invoices, remember | Done | tests/qbsync.tests.js |
| SY-UI | Months tab, snapshot load, tick months, download gap; Items tab kept | Done | tests/dev/qbsend_ui.py (23) |
| SY-PS | VaultBook-QB.ps1 menu: Read (15 txn types, per month, [VB:] keys), Send, Cycle, Check; VaultBook QuickBooks.cmd | Written, reviewed, not run here | user's first run |
Still open from the gap plan: GAP-SEND (bills, bill payments, checks, expenses, deposits, transfers, journals, credits in the batch), trial-balance tie-out per month.

## Phase 6z.15 — 1.32.0 QuickBooks Desktop section, import everything (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QF-01..04 | qbfull.js: lists, transactions (balanced rows, item accounts, groups, links, TxnIDs), plan with exact links, tie-out (also from the saved summary) | Done | tests/qbfull.tests.js |
| QBD-UI | #/qbd overview, #/qbd/tieout, side-menu group, import via preview, snapshot from overview | Done | tests/dev/qbd_ui.py (13) |
| QBD-PS | Script option 5 Export everything (lists + 16 txn types, per year), classic console UI | Written, reviewed, not run here | user's first export |

## Phase 6z.16 — 1.33.0 Payroll from paystubs (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PS-01..09 | paystub.js: OCR amount readings, columns by position, copies merged, totals solver, frequency, employer taxes, gross-up journal, posted, YTD gap, learned labels | Done | tests/paystub.tests.js |
| PR-UI | #/payroll: drop zone + offline OCR, stub cards, JE preview, post, settings (accounts, sub-accounts, learn from entry, FUTA/SUTA), posted | Done | tests/dev/payroll_ui.py (27, real OCR on a synthetic scan) |
| PR-REAL | Client's scanned stubs (May and Sept 2026, 2 employees) | All 4 tie through browser OCR | scratch check, not in repo |

## Phase 6z.17 — 1.33.1 Paystub to QuickBooks IIF tool (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PS-10 | OB.paystub.toIIF: TRNS/SPL GENERAL JOURNAL, optional ACCNT rows parents first, CRLF | Done | tests/paystub.tests.js |
| IIF-UI | tools/paystub-iif standalone page + build.py (inlines engine, pdf.js, tesseract) | Done | tests/dev/paystub_iif_ui.py (15, offline, real OCR) |
| FUT-PAY | Learn other payroll layouts (ADP, Paychex, Gusto, hourly/multi-rate, no TOTALS row), share learned labels between tool and VaultBook | Future | user will send samples |

## Phase 6z.18 — 1.34.0 Payroll documents and cross-check (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PD-01..04 | paydocs.js: recognise 9 kinds (paystubs, register, summary, EFTPS, 941, state WH return/payment, state UI return/wages), read figures, reconcile, report | Done | tests/paydocs.tests.js |
| PD-UI | Payroll screen and standalone tool: any payroll document, cross-check card | Done | payroll_ui 29, paystub_iif_ui 20 |
| PD-FORM | statement-engine: AcroForm field values in rows; OCR when text gives no figures | Done | client AZ A1-QRT read |
| PD-REAL | Client's 12 documents (summary, register, 20 paystubs, 3 EFTPS, 941 Q1, AZ/IA WH, IA UI) | 207 checks agree, 0 differ, 8 not provided | scratch check, not in repo |
| FUT-PD | Tax payment journal entries from EFTPS/state payments; per-state liability accounts; more layouts (ADP etc.) | Future | |

## Phase 6z.19 — 1.34.1 Combined payroll entry (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PS-11 | mergeDrafts: same account + memo + side added, last pay date, memo | Done | tests/paystub.tests.js |
| IIF-MERGE | Tool: Entries choice, combined preview, one entry in the .iif | Done | paystub_iif_ui 23 |

## Phase 6z.20 — 1.35.0 Payroll: post and .iif in VaultBook (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PR-BAR | Payroll screen: include ticks, Entries (per pay date / combined), Post to the books, Download .iif (create accounts option) | Done | tests/dev/payroll_ui.py (38) |
| PS-11+ | Combined importRef lists every pay date; posted() reads them | Done | tests/paystub.tests.js |

## Phase 6z.21 — 1.36.0 Dense ledger look (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| UX-CRIT | Impeccable critique of app/ (dual-agent): 25/40, P0 amounts smaller than labels | Done | .impeccable/critique/ |
| UX-FIX | typeset, layout, quieter, harden, clarify passes (studio.css authority; ui-forms, ui-pages, ui-core, ui-studio, ui-reports, ui-statements, reports.R.home opts.from/to) | Done | node 193; 26 browser suites pass |

## Phase 6z.22 — 1.37.0 Connector reports + send safety (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QB-RPT | Connector mode Reports: GeneralDetail/GeneralSummary report queries → CSV; account, period and folder pickers | Done, NOT run against QuickBooks here | static check only; needs the user's first run |
| QB-DEP | Payment ↔ QuickBooks Deposit match (script check + qbsync.compare how:'deposit') | Done | tests/qbsync.tests.js SY-05 |
| QB-SAFE | 400 ms between writes; clean stop with per-item result when QuickBooks dies; Close All advice | Done | static check |
| QB-LINK | Link existing QuickBooks deposits to invoices (0-amount ReceivePayment + SetCredit) | Future, needs a one-deposit test | |

## Phase 6z.23 — 1.37.1 Date box fix (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| DATE-TYPE | U.dateCommit: keep on change, redraw on blur/Enter; 7 date boxes + tool | Done | bankfeed_ui 43 (types the year digit by digit), payroll_ui 38, paystub_iif_ui 23, salestax_ui 30, e2e 192 |

## Phase 6z.24 — 1.38.0 GAP-SEND: bank transactions (done; script unrun)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QS-04 | qbsend.bankShape / sendList kind 'bank' / batch v3 (bank, accounts, names, skipped) | Done | tests/qbsend.tests.js |
| SY-06 | qbsync.compare family match (out/in/move/journal by date+amount) | Done | tests/qbsync.tests.js |
| QS-UI | Items tab: Bank transactions, Account filter, shared download + left-out notice | Done | qbsend_ui 26 |
| QB-BANK | Script: CheckAdd, CreditCardCharge/CreditAdd, DepositAdd, TransferAdd, JournalEntryAdd; AccountAdd/VendorAdd/CustomerAdd on confirm; duplicate checks | Written, NOT run against QuickBooks | bracket/quote scan only |
| QB-AP | Bills, bill payments, sales receipts, credit memos via connector | Future | |

## Phase 6z.25 — 1.38.1 import fix (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QI-09 | resolveAccount: "Leaf - Other" resolves by leaf name; -MULTIPLE- not a contact | Done | tests/engine.tests.js |

## Phase 6z.26 — 1.38.2 import fix (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QI-10 | dueOf: due date before document date -> document date, with a notice | Done | tests/qbfull.tests.js QF-05 |

## Phase 6z.27 — 1.39.0 statement looks (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| ST-LOOK | stmtView.look + 7 CSS looks, Show two levels, account name -> GL | Done | tests/dev/txdetail_ui.py (16) |

## Phase 6z.28 — 1.40.0 twelve statement layouts (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| ST-LOOK2 | company.statementLook; reportModel.LOOKS/twoSides/twoSidesRows; toPdf looks + twoSidedPdf; report Layout buttons; CSS for boxed/step/dense/big/two; print | Done | tests/engine.tests.js (layouts), tests/dev/txdetail_ui.py (22) |

## Phase 6z.29 — 1.40.1 layout setting fix (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| ST-LOOK3 | prefs stmtLook {k, co}: report pick valid only while company layout unchanged | Done | tests/dev/txdetail_ui.py (22) |

## Phase 6z.30 — 1.41.0 real report printing; QBO zero-balance accounts (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PR-01 | UI.printReport / UI.printPdf, Ctrl+P and Print buttons intercepted | Done | tests/dev/txdetail_ui.py (24) |
| QO-07 | qboComplete: zero-balance accounts typed from name | Done | tests/qbo.tests.js |

## Phase 6z.31 — 1.41.1 QBO type from GL order (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QO-08 | qboLedgerOrder + placed(): neighbours bound the type | Done | tests/qbo.tests.js |

## Phase 6z.32 — 1.42.0 VaultBook Intelligence (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| VI-01..05 | intel.js extract/resolve/run, model slot contract | Done | tests/intel.tests.js |
| VI-UI | ui-intel.js panel, top bar button, Ctrl+I, optional Prompt API | Done | tests/dev/intel_ui.py (14) |

## Phase 6z.33 — 1.42.1 panel polish (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| VI-UI2 | remove side-stripe accent from answers | Done | tests/dev/intel_ui.py (14) |

## Phase 6z.34 — 1.43.0 closed-year ledgers (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QI-11 | rebuildGroups: Closing Entry rows, Split-column counter lines, transfer re-pairing, RE fallback | Done | tests/engine.tests.js |
| QI-12 | Q.statementTotals + QB-CLOSED entry with Retained Earnings proof | Done | tests/engine.tests.js |
| QI-13 | name clash with system account; listDate vs last transaction; pdfText line tolerance; RE in verifyText | Done | tests/engine.tests.js, migrate_ui 38 |

## Phase 6z.35 — 1.44.0 General Ledger from PDF (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QI-14 | Q.pdfKind/pdfLedger/pdfTypes/pdfChart/pdfInputs; pdfText keeps positions | Done | tests/engine.tests.js |
| QI-15 | pairBySplit; opening date at prior fiscal year end; print-date note | Done | tests/engine.tests.js, migrate_ui 38 |

## Phase 6z.36 — 1.45.0 Extra help for new payees (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| AP-01 | OB.hints learn/fromClients/fromCommon/coverage | Done | tests/hints.tests.js |
| AP-02 | Bank feed Extra help switch, count, badge; not in bulk select | Done | tests/dev/hints_ui.py 9 |

## Phase 6z.37 — 1.45.1 Common merchants list (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| AP-03 | js/merchants.js 1,487 names, screened; account order for supplies and bank fees | Done | tests/hints.tests.js HT-05 |

## Phase 6z.38 — 1.45.2 Extra help across all companies (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| AP-04 | Usage-first account choice, used parent kept, bank words not learned, index | Done | tests/hints.tests.js HT-06..HT-11 |
| AP-05 | Browser: empty, password-protected and data-v2 companies | Done | tests/dev/hints_ui.py 12 |

## Phase 6z.39 — 1.46.0 Close the books (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CB-01 | OB.close prepare/post/accept/groups/selfTest/checklist/flux/adjusting/signOff | Done | tests/close.tests.js CL-01..07 |
| CB-02 | Close the books page, eight steps, menu, Gateway, palette | Done | tests/dev/close_ui.py 18 |
| CB-03 | Sign-off package, multi-client view | Planned 1.47 | — |

## Phase 6z.40 — 1.47.0 Update QuickBooks to match VaultBook (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QU-01 | OB.qbupdate plan/batch/toText: line, header and void changes, new accounts | Done | tests/qbupdate.tests.js QU-01..06 |
| QU-02 | Update QuickBooks page, link and file ways, results | Done | tests/dev/qbupdate_ui.py 13 |
| QU-03 | Connector: CheckMod/DepositMod/JournalEntryMod, TxnVoid, 7 link, 8 install | Built, to confirm on the user's PC | — |

## Phase 6z.41 — 1.47.1 Excel and CSV bank files (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| XS-01 | Debit/Credit type column, header row below titles, sheet choice | Done | tests/sheets.tests.js XS-01..07 |
| XS-02 | Excel in the Bank feed column step; statement reader uses the same engine | Done | tests/dev/sheets_ui.py 52 (13 layouts x xlsx/csv x 2 paths) |

## Phase 6z.42 — 1.48.0 Paste entries (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PE-01 | OB.paste: TSV and report paste, repeat monthly, plan (types, splits, missing accounts, names, duplicates), post | Done | tests/paste.tests.js PE-01..07 |
| PE-02 | Paste entries page, ledger button, menus | Done | tests/dev/paste_ui.py 16 |

## Phase 6z.43 — 1.48.1 Split one amount from Excel (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| PE-03 | Blank-date lines, Entry # grouping, multi-account Split cell, Join | Done | tests/paste.tests.js PE-08..10; tests/dev/paste_ui.py 19 |

## Phase 6z.44 — 1.49.0 Doc Center (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| DC-01 | OB.docs: inbox, readName/readText, suggest, missing, cleanup, package | Done | tests/docs.tests.js DC-01..07 |
| DC-02 | Doc Center page, menus, Close the books line | Done | tests/dev/docs_ui.py 15 |

## Phase 6z.45 — 1.50.0 Calendar (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CA-01 | OB.cal: events, business days, tax deadlines, payroll projection, to-dos, forecast, .ics | Done | tests/calendar.tests.js CA-01..06 |
| CA-02 | Calendar page, actions, drag pay date, reminders, menus | Done | tests/dev/calendar_ui.py 17 |
| CA-03 | Firm view of every client's deadlines | Skipped by the user | — |

## Phase 6z.46 — 1.50.1 Calendar interactions (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CA-04 | Times, reminders, moved/skipped repeats, expected dates, move/undo/bulk | Done | tests/calendar.tests.js CA-07..08 |
| CA-05 | Click to add, drag (one or many), hour grid draw/move/resize, popovers, keys, undo | Done | tests/dev/calendar_ui.py 26 (real mouse and keyboard) |

## Phase 6z.47 — 1.50.2 Typed dates and duplicates (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| DT-01 | U.dateCommit: redraw on Enter, leaving or a calendar pick, never mid-typing | Done | tests/dev/dates_ui.py 5 |
| DU-01 | One forecast engine; one spreadsheet door; Reclassify to Books; dead Dashboard removed | Done | tests/calendar.tests.js CA-09; tests/dev/sheets_ui.py 52 |

## Phase 6z.48 — 1.50.3 Reports follow typed dates (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| DT-02 | U.dateCommit applies a complete typed date after a pause, keeps focus | Done | tests/dev/dates_ui.py 6 |

## Phase 6z.49 — 1.50.4 No how-to notes (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| UX-01 | UI.page draws a subtitle only for data ({ html }); how-to tips removed | Done | e2e 192, studio 40, designer 40, calendar 26, paste 19, docs 15, close 18 |

## Phase 6z.50 — 1.51.0 Menu bar, toolbar, Version F colours (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| MB-01 | js/ui-menubar.js: 13 menus built from existing routes, keyboard, Window list | Done | tests/dev/menubar_ui.py 17 |
| MB-02 | Icon toolbar in the top bar; icons taken from the side menu links | Done | menubar_ui MB-09, MB-10 |
| MB-03 | Side menu off by default (once, pref menubarSeen); company opens on #/dashboard | Done | menubar_ui MB-03, MB-11; e2e 192 |
| MB-04 | studio.css tokens: grey chrome, blue accent, light and dark | Done | menubar_ui MB-15; studio 40 |

## Phase 6z.51 — 1.57.0 Bank feed uses the books' history (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| FE-01 | hints.js: payeeText, vendorMatch (joined, cut-off, noise, start/inside) | Done | close.tests CL-08 |
| FE-02 | close.js: habits by contact, deposit-line payer, money back, C.forFeed | Done | CL-09, CL-10 |
| FE-03 | Bank feed: levels, counts, select sure, sort/show pickers, same-payee select | Done | tests/dev/feedengine_ui.py 11 |
| FE-04 | Match finding remembered until the books change; date windows; far matches not auto | Done | CL-11; FE-10 |
| FE-05 | Bulk post decides first, then posts | Done | user's file: 509 lines in 3.5 s |
| FE-06 | merchants.js: 185 more brands | Done | hints_ui 12 |

## Phase 6z.52 — 1.58.0 Send to QuickBooks from a date (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QF-01 | qbsend.js: Q.fromDate (from a day, not yet in QuickBooks, earlier invoices of included payments, left-out types) | Done | qbsend.tests QS-10 |
| QF-02 | Entries imported from QuickBooks count as already there (importRef TxnID) | Done | QS-10 |
| QF-03 | From a date tab, menu and toolbar links | Done | tests/dev/qbfrom_ui.py 6 |

## Phase 6z.53 — 1.59.0 Send by period, straight to the tool (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QF-04 | Q.fromDate(book, from, to): one day or a period | Done | qbsend.tests QS-10 |
| QF-05 | By date tab: period choices, remembered | Done | tests/dev/qbfrom_ui.py QF-07..09 |
| QF-06 | Send to QuickBooks now through the existing link (apply), result applied | Done | qbfrom_ui QF-10..12 |

## Phase 6z.54 — 1.60.0 Connector menu in plain order (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CM-01 | VaultBook-QB.ps1: menu reordered and renamed (7 lines), start box shortened, header comment | Done (not run on Windows) | ASCII and LF checked; bracket count |
| CM-02 | Screens and guide use the new names and numbers | Done | qbd_ui, qbupdate_ui, qbsend_ui |

## Phase 6z.55 — 1.60.1 Long dash stopped a send (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QX-01 | U.qbText; used by qbsend and qbupdate clean() | Done | qbsend.tests QS-11 |
| QX-02 | Connector X(): plain forms and numeric references | Done (not run on Windows) | ASCII and LF checked |

## Phase 6z.56 — 1.61.0 Long sends in parts, resumable (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QP-01 | Q.chunks (order across parts), Q.resultSummary (stopped / declined) | Done | qbsend.tests QS-12 |
| QP-02 | runSend: parts through the link, result applied per part, progress, halt, resume | Done | tests/dev/qbfrom_ui.py QF-13..15 |
| QP-03 | Connector: apply accepts yes for later parts; /hello version 1.61; 0.7 s between bank entries | Done (not run on Windows) | ASCII and LF checked |

## Phase 6z.57 — 1.62.0 Bank transactions of a period as .iif (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QI-01 | Q.inQB, Q.markIIF; sendList and fromDate use them | Done | qbsend.tests QS-13 |
| QI-02 | X.txnsIIF (chosen transactions); Bank feed export skips what is in QuickBooks | Done | QS-13 |
| QI-03 | By date tab: .iif button, import question | Done | tests/dev/qbfrom_ui.py QF-16..19 |

## Phase 6z.58 — 1.63.0 Remove what VaultBook sent; empty check numbers (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| QR-01 | Connector: empty RefNumber for checks without a number | Done (not run on Windows) | ASCII and LF, bracket count |
| QR-02 | Connector 8 Remove: [VB:] entries in a date range, typed DELETE, TxnDel in a safe order, result file | Done (not run on Windows) | same |
| QR-03 | VaultBook: Deleted items clear the sent mark; failed removals keep it; .iif memos carry [VB:] | Done | qbsend.tests QS-13, QS-14 |

## Phase 6z.59 — 1.64.0 .iif from any report (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| RI-01 | X.anyIIF: invoices and bank transactions in one file; in-QuickBooks and other types left out | Done | qbsend.tests QS-15 |
| RI-02 | Report .iif button, tick boxes, select all, progress, import question | Done | tests/dev/reportiif_ui.py 13 |

## Phase 6z.60 — 1.65.0 Citi card statements (done)
| ID | Task | Status | Evidence |
|---|---|---|---|
| CT-01 | Citi reader in the statement engine: one-date payment, post date, card signs, spaced words, wrapped names, no rewards/footer text, cardholder sections, Account summary totals | Done | tests/dev/citicard_ui.py 9 |
| CT-02 | Same reader in Statement Studio V8.16 | Done | 118 of 118 lines on the client statement, both totals match |

## Phase 7 — Release verification

| Task ID | Requirement IDs | Task | Acceptance criteria | Status | Evidence / notes |
|---|---|---|---|---|---|
| QA-001 | QA | Run full regression suite | Results recorded; failures fixed or explicitly documented | NOT STARTED | |
| QA-002 | QA | Test keyboard-only workflows | Home → entry → save → report → drill-down → back succeeds | NEEDS VERIFICATION | Gateway → F8 entry → Ctrl+S → T trial balance → Enter drill-down → Esc back passes in Chromium automation (vaultbook_ui.py). Not run on real Windows/macOS Chrome. |
| QA-003 | QA | Verify accounting integrity | Trial balance and key reports reconcile to posted transactions | NOT STARTED | |
| QA-004 | QA | Verify offline/data persistence | Core workflows operate offline; data survives reload | NOT STARTED | |
| QA-005 | QA | Verify backup/restore and migrations | Recovery tests pass using a safe test dataset | NOT STARTED | |
| QA-006 | QA | Final requirement audit | No requirement silently omitted; all statuses have evidence | NOT STARTED | |

## Requirement traceability (AUD-005)

| Spec section | Requirement IDs | Tasks | Existing tests / evidence |
|---|---|---|---|
| §1–2 Goal, principles | (all) | QA-006 | — |
| §3 Shell and Gateway | GATEWAY, UI-001 | FOUND-006, NAV-002 | E: dashboard loads; no Gateway yet |
| §4 Navigation model | NAV-001, MENU, HISTORY | FOUND-003, NAV-003, NAV-006, BUG-002, BUG-003 | E: unsaved guard on links/back/window tabs |
| §5 Function keys / shortcuts | KEY-001, KEY-002 | FOUND-004 (PASS), FOUND-005, BUG-004, BUG-005 | E: Ctrl+K, ?, mnemonics; AUDIT_BASELINE §5 |
| §6 F11 Company Features | F11 | CFG-001 | E (features tab partial) |
| §7 F12 Configuration | F12, CFG | CFG-002, CFG-003 | E: theme/density persist |
| §8 Contextual action panel | ACTIONS | NAV-004 | — |
| §9 Transaction entry | ENTRY | ENTRY-001…007 | N: posting rules, duplicates, validation; E: entry, save failure, duplicate prevention |
| §10 Registers and tables | TABLES | REPORT-001, BUG-001 | E: column resize/hide/persist, sticky header |
| §11 Reports and drill-down | REPORTS | REPORT-002…007 | N: P&L/BS/TB/CF/BvA/1099/builder; E: P&L→GL drill-down, Excel/CSV |
| §12 Command palette / Go To | SEARCH | NAV-005 | E: palette search/actions/empty/Esc |
| §13 Visual design | ARCH-002, UI | FOUND-002, A11Y-002, BRAND-001, MOD-006 | A: axe baseline |
| §14 Architecture and data | ARCH-001, MODULES | FOUND-001, MOD-001…005, DOC-001 | N: migrations, backup, atomic writes, security |
| §15 Accessibility / platform | UI | MOD-006, A11Y-001, A11Y-002, QA-002 | A: 8 issue types baseline |
| §16 Quality gates | QA | QA-001…005 | N + E + A commands in AUDIT_BASELINE §3 |
| §17 Definition of done | QA | QA-006 | — |

## Next task selection rule
Select the highest-priority task whose dependencies are satisfied. Prefer small vertical slices with observable behavior. Do not start dependent phases before their foundations are stable. Update this table after each verified task.
