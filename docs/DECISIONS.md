# Architecture and Product Decision Log

Record important decisions here. Add new entries at the top. Do not silently reverse an existing decision; add a new entry explaining the change and impact.

## DEC-012 — QuickBooks migration policy
- Date: 2026-11-04 · Status: Accepted
- Context: Users move whole companies from QuickBooks Desktop using its standard exports (IIF lists, General Ledger CSV by account, address TXT, P&L/BS PDFs). The GL CSV has no transaction id.
- Decision: (1) Import only into a company with no posted transactions, in one atomic write (`Book.importBundle`); every transaction goes through normalize/validate/buildSplits. (2) COA `OBAMOUNT` values are QuickBooks *current* balances: used to verify, and to post one dated "QB-OPEN" journal for any difference (user may skip). (3) GL rows are grouped into transactions by (type, date, num, name), widening to (type, date, num) → (type, date) → date only for unbalanced groups, and split by subset-sum when one group holds several A/R/A/P/bank heads. (4) Payments apply by the document numbers in their reference, then an exact-amount document, then oldest first; all documents are registered before payments because QuickBooks allows a payment dated before its invoice. (5) Duplicate QuickBooks document numbers get suffixes ("1017-2") because VaultBook enforces unique numbers. (6) Non-posting accounts (estimates, sales orders) are skipped with a warning; unused default VaultBook accounts are made inactive, not deleted.
- Alternatives: posting OBAMOUNT as opening balances (wrong — would double count); free-form merge into a company with data (risk of double posting).
- Risks: payment applications made by the oldest-first rule may differ from QuickBooks for payments without a reference (counted and shown as a warning); inventory quantities are not tracked.
- Verification: `node app/tests/run-node.js` (synthetic fixtures `app/tests/fixtures/qb`), `app/tests/dev/migrate_ui.py`; real client export checked outside the repo (all 66 balances equal, PDFs match).

## DEC-011 — Data format 4: products/services and import history
- Date: 2026-11-04 · Status: Accepted
- Decision: `DATA_VERSION` 3 → 4 (migration adds `items: []` and `company.imports: []`); IndexedDB company DB 3 → 4 creates the `items` store only if missing. No existing store, key or identifier changes (DEC-006).
- Rollback: older app versions ignore unknown stores; backups still carry every earlier field. Restoring a v4 backup into 1.8.0 is not supported (it would drop items).
- Verification: Node migration test (v2 → v4), backup round trip with items; browser upgrade test — a company created by 1.8.0 (data v3) opened in 1.9.0: transactions 54 = 54, A/R equal, integrity 0 issues, an item saved and persisted after reload.

## DEC-010 — VaultBook key map (adapted from Tally conventions, browser-safe)
- Date: 2026-10-22 · Status: Accepted
- Decision: F1 Help · F2 Date (entry) / Period (report) · F3 Switch company · F4 Transfer · F5 Expense · Alt+F5 Vendor credit (on reports with groups: detailed/condensed) · F6 Receive payment · Alt+F6 Credit memo · F7 Journal entry · F8 Invoice · Alt+F8 Sales receipt · F9 Bill · Alt+F9 Pay bills · F10 All transaction types · F11 Company Features · F12 Configure · Alt+G Go To (Ctrl/⌘+K kept) · Alt+K Company · Alt+Y Data · Alt+O Import · Alt+X Export · Alt+P Print · Esc back · ↑↓/Enter row cursor and drill-down · plain letters = Gateway hot letters.
- Why: Alt+E/Alt+F open the browser menu on Windows Chrome/Edge and Alt+D focuses the address bar, so Export uses Alt+X. Ctrl+A (Tally "accept") stays Select All; saving remains Ctrl/⌘+S. Every key action is also a clickable button in the function-key panel or a menu, because macOS needs Fn for F-keys and some browsers reserve F5/F11/F12.
- Risk / verification: verified only in Chromium automation (Linux). Real Windows and macOS browsers must be checked (F5 reload, F11 full screen and F12 devtools reservations vary).

## DEC-009 — Gateway is the home screen; Dashboard kept
- Date: 2026-10-22 · Status: Accepted
- Decision: Opening a company and the empty route land on `#/gateway`. The existing Dashboard stays as a Gateway item, sidebar link and G D shortcut. The pinned home window is the Gateway.
- Impact: e2e waits for `.gateway, .dash` (test change documented in PROJECT_STATE).

## DEC-008 — Original "Ledger Workspace" design system
- Date: 2026-10-22 · Status: Accepted
- Decision: Separate layer `css/vault.css` loaded last; deep-teal chrome, white surface, one warm amber selection bar, 14px base (13px compact), dense single-line rows, sticky title bars, "Label : value" configuration windows. No Tally logo, colours copied by value, assets or wording beyond generic accounting terms ("Gateway", "Day Book", "Vouchers" are used as plain descriptive words).
- Rollback: remove the `vault.css` link and the five `ui-keys/gateway/config/entry` scripts; the 1.7.0 UI remains intact underneath.

## DEC-007 — Window manager actions obey the unsaved-changes guard
- Date: 2026-10-22
- Status: Accepted
- Context: Audit found window tab switch/close/cycle/new-tab set `UI._allowNav = true` and skipped `UI.confirmLeave`, silently discarding typed entries (BUG-002).
- Decision: Every window action that leaves or re-renders the active view goes through `UI.confirmLeave`. Closing a background window does not prompt. No change to the accounting engine or stored data.
- Alternatives considered: Keep each window's form alive in memory (true MDI). Rejected for now — larger change; revisit with FOUND-003 navigation stack.
- Risks: One extra dialog when switching windows with unsaved edits (intended).
- Verification: 4 e2e checks (fail on old code, pass on new); Node 39/39.

## DEC-006 — Product name is VaultBook; storage identifiers stay unchanged
- Date: 2026-10-22
- Status: Accepted (naming requested by the owner)
- Context: The owner named the project VaultBook. The code is branded OfflineBooks US, and its IndexedDB names (`OfflineBooksUS`, `OfflineBooksUS_<id>`), localStorage keys (`OfflineBooksUS.prefs.v1`, `OfflineBooksUS.windows.v1`) and backup format id (`OfflineBooksUS-Backup`) identify existing user data.
- Decision: Use "VaultBook" in docs now and in visible UI via task BRAND-001. Never rename storage identifiers or the backup format id; restore must keep accepting `OfflineBooksUS-Backup` files. Internal JS namespace `OB` stays.
- Alternatives considered: Full rename including storage with a migration — rejected: risk of orphaning books for no user benefit.
- Risks: Mixed internal/external names; documented here.
- Impact: Adds BRAND-001. Supersedes the product name (not the content) of DEC-003 and AGENTS.md.

## DEC-001 — Preserve existing application architecture
- Status: Accepted
- Decision: Upgrade the existing application in place. Inspect the actual code before deciding on implementation details. Do not rewrite the application from scratch just to achieve the new UI.
- Reason: Reduces risk to working accounting logic, stored data, offline behavior, and existing features.
- Consequences: The UI redesign must fit the current architecture unless a documented technical constraint justifies a change.

## DEC-002 — Offline-first and local data integrity
- Status: Accepted
- Decision: Preserve offline operation and the existing data-storage architecture. The known direction is IndexedDB, but verify the actual implementation.
- Reason: User data and bookkeeping workflows must remain available locally.
- Consequences: No required cloud service or external database. Any necessary migration must be versioned and tested.

## DEC-003 — Tally-inspired, not a copy
- Status: Accepted
- Decision: Adopt the usability principles of Tally Prime—Gateway navigation, contextual actions, function-key conventions, compact entry windows, and report drill-down—while creating an original OfflineBooks US interface.
- Reason: The product serves US accounting workflows and must maintain its own identity.
- Consequences: Do not use Tally branding, logos, proprietary assets, source code, or India-specific workflows unless explicitly requested.

## DEC-004 — Function keys are contextual and tested
- Status: Accepted
- Decision: Use a centralized shortcut registry with context-sensitive actions. Proposed F1–F12 mappings in the product specification are starting conventions, not hardcoded assumptions.
- Reason: Shortcut conflicts vary by platform, browser, focus context, and existing implementation.
- Consequences: Audit existing shortcuts first; document each assignment; test Windows/macOS where feasible; preserve normal text editing.

## DEC-005 — Evidence-based completion
- Status: Accepted
- Decision: A task is complete only when acceptance criteria pass and evidence is recorded.
- Reason: Prevents screens from being marked done when interactions, persistence, or accounting behavior are broken.
- Consequences: Use `NEEDS VERIFICATION` when tests cannot be run. Never invent test results.

## DEC-013 — Financial reporting: one engine, own Excel and PDF writers, no new dependencies
- Date: 2026-11-04
- Status: Accepted
- Context: Request for Statement Writer–class reporting with professional PDF and Excel. Research in `docs/REPORTING_PLAN.md` §3 (JasperReports, ExcelJS, jsPDF, pdfmake, AG Grid, Tabulator, bundled SheetJS 0.18.5).
- Decision: Keep `R.statement` as the only calculation path. Add a shared report model (`report-model.js`) feeding screen number text, Excel and PDF. Extend the existing dependency-free `xlsx.js` (styles, merges, frozen panes, print setup, formulas) and add a ~200-line PDF writer (`pdf.js`, standard Helvetica, WinAnsi, Adobe AFM widths). Report templates are evaluated on top of `R.statement` value columns (`designer.js`).
- Alternatives considered: SheetJS for styled output (Community edition cannot write styles); ExcelJS (~1 MB, duplicate of `xlsx.js`); jsPDF/pdfmake (350 KB–2 MB, less control over pagination); AG Grid/Tabulator (would replace the accessible statement table); JasperReports (Java server).
- Risks: PDF uses standard fonts only (no embedded fonts, so characters outside WinAnsi print as "?"); no images/logos in PDF headers.
- Impact on requirements/tasks: FR-001…FR-006.
- Verification needed: Real Excel (Windows/macOS) opening; printing PDFs on physical printers.

## DEC-014 — Report templates live in the saved-reports store
- Date: 2026-11-04
- Status: Accepted
- Context: Templates must persist, be backed up and survive restore without an IndexedDB migration (AGENTS rule 14).
- Decision: A design is a saved report `{ report: 'designer', params: { def } }`. Data format stays 4, IndexedDB versions unchanged. Exported files are JSON with `format: 'vaultbook-report-template', version: 1` and a JSON Schema id; account ids are dropped on import when they do not exist in the company.
- Alternatives considered: A new `templates` store (needs DB v5 and a backup format change).
- Risks: Older VaultBook versions list a design under My reports but cannot open it.
- Verification: Node test "saved-reports store"; designer_ui.py save → reload → My reports; existing backup round-trip test covers the store.

## DEC-015 — Financial workbook: one data sheet, formulas everywhere, snapshot only
- Date: 2026-11-04
- Status: Accepted
- Context: Request for an interactive, editable Excel workbook (12 report sheets, drill-down, date filters that recalculate, SUMIFS, tables, charts, optional protection), evaluated against SheetJS, ExcelJS and Apache POI.
- Decision: Write `R.entries` (the engine's posted lines for the chosen basis) once to "Data - Ledger Lines" for all dates up to the export To date; every report sheet is SUMIFS/COUNTIFS over defined names (`L_*`) and the Dashboard `FromDate`/`ToDate` cells. Formula text and cached value come from one criteria definition (`workbook.js` `F.sumifs`). Native internal hyperlinks for drill-down. Extend the own writer (`xlsx.js`); DEFLATE via the platform `CompressionStream`. Ledger and journal lines cover the export period (balances still use all earlier data). Aging is the open-item snapshot on the export date, with days past due following an editable aging date.
- Alternatives considered: SheetJS Community (cannot write styles), ExcelJS (~1 MB and would duplicate `xlsx.js`), Apache POI (Java, not browser-only), per-sheet copies of the data (duplication), FILTER/dynamic arrays (not in Excel 2016/2019 or older LibreOffice).
- Risks: Not opened in Microsoft Excel in this sandbox (LibreOffice + openpyxl + SheetJS + XML well-formedness only); aging and journal lines do not move with the date cells; one sheet ≤ 1,048,576 rows (export refuses with a clear message).
- Verification: `app/tests/dev/workbook_check.py` (LibreOffice UNO recalculation, changed dates vs engine), Node tests, `workbook_ui.py`.

## DEC-016 — Invoices: one drawing for screen and PDF; QuickBooks-style entry; IIF writer
- Date: 2026-11-04
- Status: Accepted
- Context: User asked for an exact copy of their sample invoice, a QuickBooks Desktop style invoice screen, and .iif export for QuickBooks Desktop.
- Decision: `invoice-layout.js` builds one list of drawing operations in PDF points from the sample's measured geometry; the screen draws it as SVG and the PDF writer writes the same operations (Times New Roman / Arial / Arial Bold as non-embedded TrueType with Liberation-metric widths). The sample's logo is not shipped; a company may add its own. The entry screen reuses the existing form engine and field names (only markup and CSS differ) and shows only commands VaultBook implements (no Email, Attach, Memorize, Template). `qbexport.js` writes IIF invoices (TRNS/SPL/ENDTRNS) with optional ACCNT/CUST/INVITEM lists; verified by reading the file back through `qbimport.js`.
- Alternatives considered: HTML/CSS invoice (screen and PDF would drift); embedding fonts (size, licensing); copying QuickBooks icons (proprietary assets).
- Update (1.12.1, user request): the entry screen keeps the QuickBooks layout but is styled only with VaultBook theme tokens (light/dark); only the outgoing print/PDF keeps the sample/QuickBooks format.
- Risks: Fonts not embedded — viewers without Times New Roman/Arial substitute metric-compatible fonts; real QuickBooks import not tested here; the sample's embedded license table is not reproduced (text lines only).
- Verification needed: import into QuickBooks Desktop; print on a real printer.

## DEC-017 — ER-design audit; sales tax, non-posting documents, hash-chained audit (1.13)
- Date: 2026-11-05
- Status: Accepted
- Context: The user supplied an ER design for an offline US accounting product and asked for an audit and professional-level improvements, excluding a database change. Audit: `docs/ERD_AUDIT.md`.
- Decision:
  - **Sales tax:** rates live on the company record, stored as integer millionths. Documents keep `taxId`, `taxRate`, `taxableAmount` and `tax` (the TAX_LINE equivalent). Tax is one split to the liability account. Reports read the lines.
  - **Estimates and POs:** new transaction types with `nonPosting: true`, status open/closed/void and no splits. `sourceId`/`linkedTo` are the DOC_LINK equivalent.
  - **Audit trail:** each entry carries `prev`/`hash` (synchronous SHA-256, so entry creation stays synchronous). The chain tip is cached and rolled back when a write fails. Verification follows the links, not the store order, because ids are random.
  - **Closing date:** a password gates moving the closing date (iterated salted SHA-256), and changes are kept in a history.
  - **Credit limit:** UI-only warning.
  - **Data and stores:** data format 5 migration. No new IndexedDB store or version.
- Alternatives considered: a TXN_VERSION table with reversal lines (a storage redesign the user excluded; edits keep the `before` copy in the audit log); WebCrypto SHA-256 (async, which would ripple through every save path); multi-jurisdiction tax codes (a combined rate per code is what QuickBooks Desktop users enter as a tax group, so it was kept simple).
- Risks:
  - Deleting the newest audit entry can't be detected by a chain alone.
  - Editing a taxed document after changing its rate uses the new rate.
  - The AUTOSTAX column in .iif is unverified against real QuickBooks.
- Verification needed: .iif with sales tax imported into QuickBooks Desktop.

## DEC-018 — Design floor from the Impeccable audit (1.18.1)
- Date: 2026-11-05
- Status: Accepted
- Context: The Impeccable rendered scan found 288 functional labels below 11px (14px root, compact 13px), thick colored side stripes and nested boxes.
- Decision: All font sizes below .8rem are written `max(11px, …)`. Accents are 1px borders or tints, never >1px side stripes or glows. The dashboard and totals have no card inside a card. A sidebar link with a query string (Invoices, Bills) wins over the bare route link.
- Alternatives considered: raising the root font size (rejected: it changes every layout and the QuickBooks-dense feel).
- Risks: none to data; a slightly taller UI in compact density.
- Impact on requirements/tasks: UX-030. Audit report in docs/DESIGN_AUDIT.md.
- Verification needed: detector rescan (0 undersized); all suites.

## DEC-019 — CPA audit fixes (1.19.0)
- Date: 2026-11-05
- Status: Accepted
- Context: CPA_AUDIT_FIX_PROMPT.md (CPA-01…25). Each finding was reproduced by a failing test before the fix.
- Decision:
  - CPA-01 the first finance charge counts from the due date; later ones from the last charged-through date; grace stays a threshold.
  - CPA-02 a posted document keeps its tax rate; credit memos take the source invoice's rate; re-tax only on request.
  - CPA-03 overselling is blocked by default (Features switch); one cost formula; automatic recost after saves/voids; a closed-period difference is posted as one value-only adjustment the day after the closing date.
  - CPA-05/08 applications carry a date; effective date = max(source, target, application date). The early-payment warning lives in warnings().
  - CPA-07 cash basis recognises the deposit-funded part of an invoice on the invoice date.
  - CPA-09 write-offs reverse the tax part by default.
  - CPA-10 cash flow: depreciation add-back, Undeposited Funds is cash, per-account section override.
  - CPA-11 MQ tables are generated by the Pub. 946 method; the generator reproduces Table A-1 exactly (tested). Disposal = catch-up depreciation, then one journal; voiding it restores the asset. Two writes (depreciation, disposal) — a failure between them leaves correct depreciation posted.
  - CPA-12 deposits are capped at what is held; refunds are checks against Customer Deposits.
  - CPA-13 discounts are separate credit memos / vendor credits (Sales Discounts income, Purchase Discounts COGS), non-taxable, saved with the payment through the new atomic saveTransactions. A bounced payment is an invoice crediting the bank the money landed in (so it can be paid and aged), plus an expense for the bank fee; the payment itself is untouched.
  - CPA-14 reversal default date = day after the original's month end.
  - CPA-15–18 are warnings only (forms: "Save anyway"); imports never call warnings().
  - CPA-19 needs the closing password only when one is set. CPA-20 statement dates must increase.
  - CPA-21 void-as-of is refused for documents applied to others, deposited, or moving inventory (use bounced payment for payments).
  - CPA-22 applies only when the line's taxable flag is not given (API/new docs); the form sets the checkbox the same way when a discount item is chosen.
  - CPA-23 `exempt` is stored true/false on every taxable document with a customer; older documents fall back to the customer flag.
  - CPA tests live in tests/cpa.tests.js (not engine.tests.js) to keep the plan's evidence in one file.
- Alternatives considered: discount lines on the payment itself (rejected: changes payment totals across cash basis, deposits and reconciliation).
- Risks: documents voided as of a date still exist in their period by design.
- Impact on requirements/tasks: CPA-01…25.
- Verification needed: node 109/0; all browser suites.

## DEC-020 — Bank feed inbox (1.20.0)
- Date: 2026-11-06
- Status: Accepted
- Context: the bank UX audit (claude doc "VaultBook bank feed UX audit"): one-shot import, wrong description column on Chase files, transfer double count, no undo, no matching.
- Decision:
  - Imported lines are stored (new stores bankLines, bankImports; IndexedDB v6) and wait in For review; nothing posts on import.
  - Each posting is one commit: the line and the transaction it creates or matches, via saveTransaction; the bank split is marked cleared so Reconcile starts ticked.
  - Candidates: entries in the same account with the same amount, 90 days before to 20 days after, not reconciled, not already claimed (this is how the other side of a transfer is found); open invoices/bills for exactly the amount. "Best" only when one candidate leads by 3+ points, else the user picks.
  - Suggestions: rule first, then the category used before for the same merchant text on that account; tied history gives no suggestion.
  - Undo: a match is unlinked; a created transaction is voided (audit kept). Undo import is refused while any of its lines is posted.
  - Column detection scores headers and demotes code-like columns; the date format is detected and an all-ambiguous file is flagged; a saved layout per account skips mapping.
  - Display preferences (columns, density, rows per page) live in localStorage prefs, not company data.
- Alternatives considered: keeping the one-shot wizard with fixes (rejected: no undo, no persistence).
- Risks: very large feeds (thousands of lines) compute candidates per visible page only.
- Verification: tests/bankfeed.tests.js (BF-01…17), tests/dev/bankfeed_ui.py.

## DEC-021 — Bank feed export to QuickBooks (1.21.0)
- Date: 2026-11-06
- Status: Accepted
- Context: users import 3–12+ months of statements into VaultBook, review them, and want them in QuickBooks.
- Decision:
  - Desktop gets .iif built from each transaction's splits (debit +, credit −), typed CHECK / DEPOSIT / TRANSFER / CREDIT CARD / CCARD REFUND (GENERAL JOURNAL otherwise); one transaction per bank transaction, a transfer once. Verified by reading the file back with OB.qbimport and comparing balances.
  - QuickBooks Online cannot import .iif; it gets the 3-column bank-upload CSV per account (raw lines, uncategorized).
  - Only transactions posted in VaultBook are sent (For review lines never; the user asked for this). The tool sits in the Bank feed's corner More menu as an advanced feature.
  - Default: not exported before, cleared Y, lists included; invoice/bill payments left out by default (IIF cannot apply them to QuickBooks invoices); optional deposit to A/R / payment from A/P.
  - Exports are tracked on the lines and in company.bankExports so a second export does not duplicate in QuickBooks; "Mark as not exported" reverses it.
  - The bank account's QuickBooks name can be overridden per account and is remembered (company.qbNames).
- Risks: account and name spellings must match the QuickBooks file, or QuickBooks creates new ones; the lists in the file and the name override reduce this.

## DEC-022 — TallyPrime-style keyboard work and Reclassify (1.22.0)
- Date: 2026-11-06
- Status: Accepted
- Context: the user works keyboard-first like TallyPrime and asked for F2/Alt+F2, typed dates, one P&L with options on the right, registers with filters, and QuickBooks Accountant's Reclassify Transactions.
- Decision:
  - Typed dates are US month-day order; a missing year is the current one; "20" is a day of the current month. The current date lasts for the session (a wrong date never carries over to another day); the current period is remembered per company in browser preferences and becomes the reports' default range.
  - Report options live in the right-hand key panel through UI.reportCtl, published by each report page; the old P&L/BS variants are hidden aliases so saved links still open.
  - Registers are read-only views over posted transactions (js/registers.js). Debit/credit follow Tally: sales are credits, purchases debits, bank money in a debit.
  - Reclassify edits the source documents (header account, line, journal line, transfer side) and saves them all in one saveTransactions write, so every validation runs. It refuses A/R and A/P lines, item lines' accounts (class only), reconciled or closed-period transactions, deposited Undeposited Funds and bank-feed-matched lines. Each run is kept with the before copies; Undo works while the transactions are unchanged since. Cash/accrual basis is not offered on the Reclassify screen: the lines are the same on both bases.
- Risks: Ctrl+B and Ctrl+F are taken on screens that use them (bookmarks / find in page); the browser's own find still works elsewhere.

## DEC-023 — Bank rules v2, grouped matches, already in the books, reconcile adjustment (1.23.0)
- Date: 2026-11-06
- Status: Accepted
- Context: the three items left from the bank UX audit, plus the user's idea from Statement Studio: when statements are imported after the user already typed some of those transactions in, VaultBook should find them and not add them again.
- Decision:
  - Already in the books: one-to-one pairing, strongest first, exact amount only, with the same check number (book date up to 90 days before the bank date) or a book date 7 days before to 3 days after. Reconciled and already-matched entries are never used. On by default with a checkbox in the import preview; each match is an ordinary bank-feed match (Undo unmatches). Taken from Statement Studio's reconcile passes (check number first, then closest date); its description-based "amount differs" pass is not used for automatic matching.
  - Rules v2 keep the old fields (contains) for older code; conditions are all/any; a split rule takes $ lines first and shares the rest by percent (last % line takes rounding); a rule whose split cannot carry an amount is skipped for that line. Auto-add runs after the books matching, so a rule never adds what is already in the books.
  - Several entries for one line: payments in Undeposited Funds are deposited by creating a Deposit (validated like the Make Deposits screen); several entries already in the bank account are linked with bankLines.links. Subset search is limited (≤ 40 items, ≤ 8 or 6 per group, bounded search); when two combinations add up, neither is marked best.
  - Reconcile: an adjustment is a journal entry dated on the statement date to an expense account "Reconciliation Discrepancies" (created when missing); undoing the reconciliation voids it. Each reconciliation keeps a frozen report; older ones show a rebuilt report marked as such.
  - Not taken from Statement Studio: its OCR engine (tens of MB, against the no-dependency rule) and its QuickBooks reconciliation-report PDF reader.
- Risks: two identical same-day amounts are paired arbitrarily (they are interchangeable); a user can always undo a match.

## DEC-024 — QuickBooks Online reports as an import source; company created from the files (1.24.0)
- Date: 2026-11-09
- Status: Accepted
- Context: A client sent a QuickBooks Online export set in Excel (Journal, General Ledger, Trial Balance, Balance Sheet, Profit and Loss, contact lists). The importer only knew QuickBooks Desktop files (IIF, CSV). QuickBooks Online has no chart-of-accounts file in such a set, and writes every report amount as a constant formula with a stored value of 0.
- Decision: (1) Read the Journal as the transaction source (exact grouping); rebuild from the General Ledger only when there is no Journal. (2) Take account types and sub-accounts from the sections of the Balance Sheet and Profit and Loss (or an Account List); never guess a type from a name — a missing report is an error that names the report. (3) Use the Trial Balance as the expected balance of every account (income and expense accounts only when it is for All Dates) and compare after import. (4) Read a constant formula as its number in Q.sheetRows. (5) "Create from QuickBooks files" makes the company named by the reports and opens the existing preview; posting still needs the Import button and goes through Book.importBundle.
- Alternatives considered: inferring account types from names or from the transaction side (rejected: wrong types silently change the balance sheet); importing automatically without a preview (rejected: the user must see errors and notes first); evaluating all Excel formulas (not needed: only constants carry data, totals are recomputed).
- Risks: reports renamed or customised beyond their title row are not recognised (the file is then listed as not recognised); a General Ledger-only import combines same-day entries (stated on screen); QuickBooks Online account numbers that are part of the displayed name stay in the name.
- Impact on requirements/tasks: Phase 6y. No data-format change.
- Verification needed: tests/qbo.tests.js (QO-00…06), tests/dev/qbo_ui.py; one real client set imported with every balance equal to its Trial Balance.

## DEC-025 — Studio look across the app, home widgets, grouped + New menu (1.25.0)
- Date: 2026-11-10
- Status: Accepted
- Context: The user chose design G (inspired by how QuickBooks Online is organised) with direction A's light side menu, and asked for it on every screen while keeping every keyboard function.
- Decision: (1) One stylesheet, css/studio.css, loaded last, restyles the whole app through tokens and shared components; no screen markup was rewritten except the top bar, the Dashboard and the New menu. (2) The Gateway stays the pinned home window; Gateway and Dashboard become two tabs of Home. (3) Dashboard numbers come from a new engine function R.home with tests. (4) UI.newMenu keeps its name, so F10 and every caller get the new menu. (5) VaultBook keeps its own colours and name; nothing from Intuit's branding.
- Alternatives considered: rewriting each screen (rejected: large risk to keyboard behaviour); making Business overview the first screen (deferred: the Gateway is the keyboard home and tests and users rely on it).
- Risks: denser registers are roomier by default (compact density still available); the mock-up's web font is not bundled (offline).
- Impact on requirements/tasks: Phase 6z. No data-format change.
- Verification needed: tests/studio.tests.js, tests/dev/studio_ui.py, all browser suites.

## DEC-026 — Registers fold their options; Gateway home keeps only the main roads (1.25.1)
- Date: 2026-11-10
- Status: Accepted
- Context: The user found the register side panel and the Gateway home menu too busy, the year chart too big, and the backup banner and key hints noisy.
- Decision: register options open on request (button or Ctrl+F) and stay open while a filter is on; registers get a month graph; the Gateway root keeps Create, Alter, Vouchers, Day Book, Banking, the three statements, Registers, Display More Reports, Company and Quit, and everything else moves one level down; backup reminders live in Settings only; key hints stay in tooltips and the F1 list.
- Risks: users who relied on hot letters for moved Gateway items now press one more key; the backup reminder is less visible.
- Verification needed: tests/dev/studio_ui.py, tests/dev/migrate_ui.py.

## DEC-027 — Adopt QuickBooks Online patterns, keep every Tally and QuickBooks Desktop key (1.26.0)
- Date: 2026-11-10
- Status: Accepted
- Context: The user approved the backlog in docs/QBO_DESIGN_RESEARCH.md §11 (bookmarks, gear menu, Ctrl+Alt keys, compact side menu, Posted tab, bank line note and date, one report shell with chart, home customize and privacy, on-form preview, customer hub).
- Decision: QBO patterns are added beside the existing ones, never instead: F-keys, Alt menus, Gateway letters and the QuickBooks Desktop report toolbar (More > Classic layout) all stay. Bookmarks, layout, chart, widget order and privacy are browser preferences, not accounting data. Bank line note/date go through the engine (updateBankLine, audited). Ctrl+Alt+letter is ignored when the key produces a different character (AltGr layouts). No Intuit names, logos, colours or fonts.
- Risks: Ctrl+D replaces the browser's own bookmark key inside VaultBook; Ctrl+Alt+M only saves (no e-mail offline).
- Verification needed: tests/bankfeed.tests.js BF-22, tests/studio.tests.js ST-03, tests/dev/qbo26_ui.py, all browser suites.

## DEC-028 — Several invoices per bank deposit; suggestions only for contacts the bank text points to (1.26.1)
- Date: 2026-11-11
- Status: Accepted
- Context: A client's deposit paid two open invoices; VaultBook only offered single invoices for the exact amount, and had no way to pick invoices by hand.
- Decision: combinations of one contact's open items are searched only when the bank text names the contact (spaces ignored) or lists its invoice numbers, so unrelated customers whose invoices happen to add up are not offered. A by-hand picker lists any contact's open items; part payments are allowed (amount ≤ open balance); one contact per payment, as in QuickBooks.
- Risks: a bank text with no name and no numbers gets no combination suggestion; the user picks by hand.
- Verification needed: tests/bankfeed.tests.js BF-23, tests/dev/qbo26_ui.py.

## DEC-029 — Split payments only between lines that name the same contact (1.26.2)
- Date: 2026-11-11
- Status: Accepted
- Context: Customers pay one invoice in parts on different days. The user asked that VaultBook join such lines, but never by amount alone.
- Decision: For review lines are joined only when every line's bank text names the same contact, they are within 60 days, and the invoice is dated no later than 5 days after the first payment. Each line posts its own part payment. An invoice number in the bank text outweighs amount and date. Ties list the oldest open item first and are never matched automatically.
- Risks: a customer whose name is not in the bank text gets no split suggestion (manual picker instead).
- Verification needed: tests/bankfeed.tests.js BF-24, BF-25; tests/dev/qbo26_ui.py.

## DEC-030 — One Find with three ways in; every date by default; show where it matched (1.27.0)
- Date: 2026-11-12
- Status: Accepted
- Context: The user asked for standard, advanced and universal search across all company data with any period, after researching the leading products. QuickBooks Desktop Find has Simple/Advanced but header fields only; QuickBooks Online reads phrases but limits Advanced search to two-year blocks; Xero Find & Recode allows up to nine conditions but cannot search descriptions; TallyPrime Find has field syntax and shows where a match was found; Zoho saves searches as custom views.
- Decision: one Find screen (All results / Simple / Advanced) over one engine (js/find.js). No date limit; every date unless a period is chosen. Line descriptions and line memos are searched. Up to 12 conditions, all or any. Each row lists where it matched. The typed search is shown back in plain English and can be opened as editable conditions. Search state lives in the address so Back works; saved searches are browser preferences per company. Ctrl+F opens Find except where it already filters (TallyPrime registers).
- Risks: a typed word that is also a customer's name is read as the customer; the plain-English line shows how it was read and Advanced can change it.
- Verification needed: tests/find.tests.js FD-01..04, tests/dev/find_ui.py.

## DEC-031 — Reconciliation report follows QuickBooks Reconciliation Detail; one model for screen, PDF, Excel (1.27.2)
- Date: 2026-11-12
- Status: Accepted
- Context: The user called VaultBook's reconciliation report the worst they had seen and supplied a QuickBooks Reconciliation Detail PDF. The old page was printed by the browser (figures in the PDF text layer were broken), had no running balance or Clr column, and mixed signs.
- Decision: OB.reconReport builds an OB.reportModel model in QuickBooks order and words (sections with item counts, per-section running balance, Cleared Balance, Register Balance, Ending Balance) plus a Summary view and a sign-off line. The PDF comes from VaultBook's PDF writer (portrait, repeated headings, page numbers, searchable text). report-model toPdf gains opt-in portrait and label overflow so other reports are unchanged.
- Verification needed: tests/bankplus.tests.js BP-20, tests/dev/bankplus_ui.py.

## DEC-032 — Payments go to QuickBooks Desktop as PAYMENT / BILLPMT, never as deposits to A/R (1.27.3)
- Date: 2026-11-12
- Status: Accepted
- Context: A user's invoices stayed open in QuickBooks after importing VaultBook's May bank export: payments had gone as DEPOSIT with an A/R split, which QuickBooks keeps as an unapplied credit. Intuit states IIF imports do not link payments to invoices.
- Decision: send customer payments as PAYMENT and bill payments as BILLPMT (real payments QuickBooks can apply, auto-applied when its preference is on), write the invoices and amounts in the memo, and give a payments-to-apply CSV (also for lines already exported). Remove the deposit option from the screen.
- Risks: QuickBooks' automatic apply picks an invoice of the same amount or the oldest; for multi-invoice payments the user ticks invoices from the list.
- Verification needed: tests/bankfeed.tests.js BF-26, tests/dev/qbo26_ui.py.

## DEC-033 — Payments reach QuickBooks Desktop through a direct SDK script, not Web Connector or ODBC (1.28.0)
- Date: 2026-11-12
- Status: Accepted
- Context: IIF cannot link payments to invoices (DEC-032). Options: qbXML through the QuickBooks SDK on the same PC, Web Connector (needs a SOAP service polled by QBWC), QODBC read/write (paid, yearly). All need the QuickBooks Admin to authorize once; none need Windows admin.
- Decision: VaultBook writes a JSON batch (customer, date, amount as text, bank account, invoice numbers and amounts); tools/VaultBook-QB-Connector.ps1 looks each invoice up and adds ReceivePayment with AppliedToTxnAdd. Check-only by default; -Apply writes; duplicate guard on customer + date + amount. Web Connector can reuse the same batch later.
- Risks: untested here (no Windows/QuickBooks); customer and account names must match QuickBooks exactly; QBXMLRP2 bitness (script relaunches in 32-bit PowerShell).
- Verification needed: tests/bankfeed.tests.js BF-27, tests/dev/qbo26_ui.py; user's first run on one payment.

## DEC-034 — Invoice Payment Days counts settlement from applications, payments-only for weighted days (1.29.0)
- Date: 2026-11-12
- Status: Accepted
- Context: Management wants days from invoice to payment, averages, and the full invoice/payment detail with fields they can choose.
- Decision: a dedicated engine (js/paydays.js) reads each invoice's applications (Book.incoming, dated with appliedOn, counted up to "payments up to"). Paid-in-full date is when applications reach the total; days late are never negative; weighted days use payments only (credits settle but are not payments). Fields per view are chosen and ordered in a dialog; exports use the same fields.
- Risks: invoices settled by journal entries to A/R (not applications) show as open; payments recorded without applying to invoices do not count.
- Verification needed: tests/mis.tests.js MIS-01..04, tests/dev/mis_ui.py.

## DEC-035 — One installed launcher, not a script generated per download (1.30.0)
- Date: 2026-11-12
- Status: Accepted
- Context: The user asked for a single step. Generating a .cmd/.ps1 from the browser on every download would trip Chrome/Edge download warnings, SmartScreen and antivirus, and trains users to run freshly downloaded scripts.
- Decision: VaultBook downloads only data (.json). One launcher copied once to the QuickBooks PC finds the newest VaultBook-QB-*.json in Downloads, checks, asks before creating customers/items, confirms, records, and writes a result file VaultBook reads back. Items are matched by exact name or by the longest item name the description starts with; the full description prints.
- Risks: untested against real QuickBooks here; names must match exactly; sales tax not sent.
- Verification needed: tests/qbsend.tests.js, tests/dev/qbsend_ui.py; the user's first run.

## DEC-036 — Read QuickBooks before sending; match by a memo marker, then by fields (1.31.0)
- Date: 2026-11-12
- Status: Accepted
- Context: Clients hand over QuickBooks files with some months done; the firm finishes the books in VaultBook and must send only what QuickBooks lacks, month by month in any order. CSV/IIF imports carry no QuickBooks TxnID, so exact ids are not available for imported transactions.
- Decision: the connector reads every transaction type for the period into a snapshot. VaultBook matches first by the [VB:<id>] marker the connector writes into the memo of what it records, then by type + date + number + amount (payments also without number). Matches are stored on company.qbSent. Months show states; the gap for ticked months includes invoices/bills from other months that a ticked payment pays.
- Risks: two hand-typed entries with equal type/date/number/amount could cross-match (first wins); journal entries carry no header memo so the marker cannot be used for them; the snapshot is a point in time.
- Verification needed: tests/qbsync.tests.js, tests/dev/qbsend_ui.py; user's first Read on a real file.

## DEC-037 — Full import from the QuickBooks SDK goes through the existing importer model (1.32.0)
- Date: 2026-11-12
- Status: Accepted
- Context: The user needs a client's whole QuickBooks Desktop file in VaultBook in one step, with nothing lost, and one place for every QuickBooks option.
- Decision: the connector dumps QuickBooks' own qbXML answers (lists and 16 transaction types with lines and AppliedToTxnRet) as JSON, year by year; all conversion is in tested JavaScript (js/qbfull.js), which produces the same model as IIF/CSV imports so OB.qbimport.plan, the preview and importBundle are reused. Payment links come from QuickBooks, not guessed; TxnIDs are kept in importRef for exact matching later. A summary of balances is kept for the Tie-out report. Everything QuickBooks-related lives under one side-menu section.
- Risks: inventory quantities/COGS, payroll detail, attachments and reconciliation history are not carried; early-payment discounts arrive as journal entries; first real export untested here.
- Verification needed: tests/qbfull.tests.js, tests/dev/qbd_ui.py; the user's first Export everything.

## DEC-038 — Paystubs become journal entries only when the stub proves itself (1.33.0)
- Date: 2026-11-12
- Status: Accepted
- Context: The user wants payroll JVs passed automatically from paystubs of any frequency, with different layouts to come. A misread figure must not reach the books.
- Decision: read paystubs offline (PDF text, else the vendored tesseract OCR); parse by column position under CURRENT/YTD headings; read every printed copy and keep, for each figure, the reading that makes the columns add to the stub's own TOTALS and net pay; work out a single unreadable figure from its total and mark it. Posting is blocked while anything does not tie or a line has no type. One gross-up journal per pay date through saveTransaction; employer taxes computed from company.payroll settings with YTD wage bases. Line types the user picks are learned per company. No AI model: a small vision model stays on the roadmap (Paystub Lab) because every figure can already be proved arithmetically.
- Alternatives considered: a local LLM / vision model (large download, unverifiable output); template per payroll provider (breaks on small layout changes).
- Risks: new layouts (no TOTALS row, multiple earnings rates, hours) need new tests; employer taxes are estimates when the provider computes them differently (editable); OCR speed on large batches.
- Verification needed: tests/paystub.tests.js, tests/dev/payroll_ui.py; the user's next paystub layouts.

## DEC-039 — Payroll documents are checked against each other by rules, not by a model (1.34.0)
- Date: 2026-11-13
- Status: Accepted
- Context: Clients hand over any mix of payroll paper; the user wants VaultBook to know what each is, what is needed, and to cross-verify everything.
- Decision: recognise documents by their wording (EFTPS, Form 941 lines, A1-QRT, unemployment reports, payroll-service summary views, registers), read the figures with layout-light rules, and reconcile with payroll arithmetic: federal liability = FIT + 2×SS + MC withheld + 1.45% employer MC; 941 lines; state withholding matched to the subset of employees whose state tax adds up (which also tells each employee's state); unemployment contribution = taxable × rate; FUTA 0.6% of $7,000. Only paystubs post; payments and returns verify. Missing documents are "not provided", never errors.
- Alternatives considered: an AI model to read any document (unverifiable, large); asking the user to tag each file (slow).
- Risks: other providers' summaries and other states' forms need their wording added (tests per layout); semiweekly depositors with several deposits a month are matched only when a deposit equals a month's liability.
- Verification needed: tests/paydocs.tests.js; the user's next document sets.

## DEC-040 — VaultBook's look is a dense ledger; studio.css is its authority (1.36.0)
- Date: 2026-11-13
- Status: Accepted
- Context: A design critique (25/40) found three stacked style layers (theme.css, vault.css "Ledger Workspace", studio.css "Studio") with the last one re-adding pills, 12px shadowed cards and 37-47px rows, and amounts drawn smaller than labels. The user chose "Dense ledger" and asked for all fixes.
- Decision: keep the Studio structure but set its values to a ledger: 3-4px corners, no card shadows, 28px controls and table rows, amounts at full size with bold totals, one 18px title, capitals only for column headers, status as text. Forms: autofocus, Save & New on the right, 3 starter lines that grow. The dashboard follows the app period. studio.css (loaded last) is the authority for look decisions from now on.
- Alternatives considered: rewriting into one stylesheet (large risk across 26 UI suites); a fourth override sheet (adds a layer).
- Risks: older layers still contain unused rules; invoice labels remain QuickBooks capitals.
- Verification needed: node and all browser suites; a re-run of /impeccable critique.

## DEC-041 — VaultBook Intelligence answers from rules; a language model may only read the question (1.42.0)
- Context: The user wants an assistant panel like the one in QuickBooks Online, "more advanced", with "a small LLM". AGENTS forbids dependencies and network access, and a model that writes figures can be wrong.
- Decision: `js/intel.js` turns a question into slots (what, which ones, how to show it) by rules, resolves names and periods against the book, and builds every answer from `OB.reports` and the ledger. It is read-only. An on-device model is optional and limited to filling the same slots: `ui-intel.js` uses the browser's built-in Prompt API (`window.LanguageModel`) when the browser has it and the user turns it on, only for questions the rules do not understand, with the output checked against `I.SLOT_SCHEMA`. No model file or runtime is shipped; VaultBook itself makes no network request (the browser fetches its own model).
- Alternatives considered: bundling WebLLM or Transformers.js with a small model (a runtime dependency plus hundreds of MB of weights, cannot be fetched or tested in the build environment); a local model server (network, CSP).
- Risks: the Prompt API is available only in some browsers and hardware and may not be offered to a page opened from a file; it is untested here beyond feature detection.
- Impact on requirements/tasks: VI-01..05 (tests/intel.tests.js), tests/dev/intel_ui.py.
- Verification needed: a live try of "Use it for questions I do not understand" in the user's Chrome.

### DEC-042 — Extra help for new payees: the firm's own clients or a built-in merchant list, suggestions only
- Date: 2026-11-18
- Status: Accepted (trial: the user compares the two sources on real clients before deciding)
- Context: cloud products suggest categories for new merchants from millions of other books. VaultBook is offline and learns from one company.
- Decision: a bank feed switch (Off / Other clients / Common merchants) for lines with no rule, history or match. Other clients: OB.hints.learn reads each other company on this computer when the switch is used, keeps only payee or bank words and account names in memory (no amounts, dates or customers, nothing saved), and skips password-protected companies so their data never leaves encryption. Common merchants: a hand-made list of well-known US merchants by kind of expense; payroll services left out. Both only suggest income or expense accounts; the suggestions are not offered for bulk posting.
- Alternatives considered: merchant category codes (rarely on bank statements); cloud enrichment (Plaid, Ntropy, MX) — sends client data out, rejected by the user.
- Risks: a generic merchant can be a different expense for a given client (convenience-store food under Fuel); hence suggestion only, with the reason shown.
- Impact on requirements/tasks: js/hints.js, js/ui-bankfeed.js; tests/hints.tests.js, tests/dev/hints_ui.py.
- Verification needed: the user's own firm data, many clients of the same kind.

### DEC-043 — Close the books: VaultBook prepares, the CPA reviews and signs off
- Date: 2026-11-18
- Status: Accepted
- Context: the user wants an auto-pilot that books the year from statements using past years, planned from a CPA's point of view. Market research (reports/AI bookkeeping autopilot for CPAs.md) found the same loop everywhere: post what is sure, queue the rest with a reason, a person signs off; the worst documented failure was creating entries instead of matching.
- Decision: a Close the books page with the CPA's own checklist (statements received, prepared, review, client questions, bank reconciliations, compare to last year, adjusting entries, sign off). Prepare order: match an entry already in the books, the company's bank rules, the payee's habit (last two calendar years first, 98% and the last three uses agreeing), a common merchant, else ask. Only matches, rules and sure habits to income or expense accounts may be posted; owner, loan, payroll, tax and balance sheet accounts always wait. Auto-posting is offered when the self-test on the year before has at least 20 sure lines and 95% right; below that the CPA may turn it on after a warning. Every posting goes through postBankLine and keeps its reason; undo is the bank feed's. Sign-off is refused until statements, review, questions, reconciliations and explained changes tie; it sets the closing date and writes an audit entry.
- Alternatives considered: auto-accept under a dollar threshold (rejected: suggestions are right about two in three times); fixed $5,000 variance floor (replaced by a per-client floor, default the larger of $500 and 1% of last year's income, 10%).
- Risks: a payee whose account changes during the year (seen on a real client) is posted to the old account until the reviewer corrects it; the self-test shows these cases before auto-posting is turned on.
- Impact on requirements/tasks: js/close.js, js/ui-close.js, js/bankfeed.js (prepared, ask, answer), js/ledger.js (company.close), js/hints.js (shared word helpers); tests/close.tests.js, tests/dev/close_ui.py.
- Verification needed: the user's own clients; 1.47 adds the sign-off package and the multi-client view.

### DEC-044 — Update QuickBooks to match VaultBook, and a local link to the connector
- Date: 2026-11-18
- Status: Accepted (the QuickBooks side to be confirmed on the user's PC with one test transaction)
- Context: the user changes and reclassifies, in VaultBook, transactions that came from QuickBooks Desktop, and wants QuickBooks changed to match without manual work, with the tool opened from VaultBook and talking to it directly.
- Decision: js/qbupdate.js compares linked transactions (importRef TxnID, or qbSent) with a full QuickBooks export and sends only differences: CheckMod / DepositMod / JournalEntryMod with every QuickBooks line by TxnLineID (QuickBooks removes lines an edit leaves out) and the export's EditSequence (QuickBooks refuses an entry changed there since), TxnVoid for transactions voided in VaultBook (VaultBook never deletes, so nothing is deleted), AccountAdd for accounts QuickBooks lacks. Entries only in QuickBooks are never touched. Checks with item lines are listed, not changed. The connector gains 7 Connect to VaultBook: a listener on 127.0.0.1 only, port 47321, refusing any request without the 6-digit code shown in its window or with another Host header; each request runs the normal Export or Send in that window, so the user still answers every Y/N. 8 Install the link registers vaultbook-qb: for the current Windows user (no admin) so VaultBook's Open the QuickBooks tool starts it. The app's Content-Security-Policy allows connect-src http://127.0.0.1:47321 and nothing else; every other address stays blocked.
- Alternatives considered: files only (kept as the fallback: Download the update file / Load a QuickBooks export); delete in QuickBooks for VaultBook deletions (rejected: VaultBook voids, and a void is reversible).
- Risks: untested here against a live QuickBooks (no Windows in the build environment); browsers may ask before a page opens a local link or app.
- Impact on requirements/tasks: js/qbupdate.js, js/ui-qbupdate.js, js/ui-qbd.js, index.html (CSP, menu), tools/VaultBook-QB.ps1; tests/qbupdate.tests.js, tests/dev/qbupdate_ui.py.
- Verification needed: one transaction edited and one voided on the user's QuickBooks file, then a fresh export showing 0 differences.

### DEC-045 — Menu bar and toolbar replace the side menu as the main way around; grey and blue colours
- Date: 2026-11-20
- Status: Accepted (the user chose "Version F" on the design canvas)
- Context: the user's clients know desktop accounting programs, where everything is reached from a top menu bar. The user compared four reference styles and a mix on a design canvas and chose the D1 menu bar and toolbar with the mixed style, without D1's green.
- Decision: js/ui-menubar.js adds a menu bar (13 menus) and an icon toolbar that only point at existing routes and actions. The side menu becomes a View choice (hidden once on first start). A company opens on the Business overview. css/studio.css tokens change to neutral grey with one blue accent, light and dark. The look uses patterns only (dense rows and grey table headings as in IBM Carbon, plain status labels as in SAP Fiori, number styling and soft card edges as in Stripe, quiet chrome as in Linear), adapted from the analyses in awesome-design-md (MIT, Copyright 2026 VoltAgent). No brand names, logos, fonts or colours of those companies or of Intuit are used.
- Alternatives considered: removing the side menu and Gateway (rejected: tests and keyboard users rely on them); rebuilding the dashboard to the demo layout (deferred: the existing widgets already show the same figures).
- Risks: on windows narrower than about 1500 px some toolbar buttons drop off (the menus still reach them); users who liked the side menu must switch it back on once.
- Impact on requirements/tasks: js/ui-menubar.js, css/studio.css, index.html, js/prefs.js, js/ui-core.js, js/ui-keys.js, js/ui-studio.js; tests/dev/menubar_ui.py; four older UI tests seed the side menu on.
- Verification needed: the user's eye on the real app; a Windows check at 125% display scaling.

## Decision template
### DEC-XXX — Title
- Date:
- Status: Proposed / Accepted / Superseded
- Context:
- Decision:
- Alternatives considered:
- Risks:
- Impact on requirements/tasks:
- Verification needed:
