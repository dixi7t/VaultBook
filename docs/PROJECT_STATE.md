# Project State — VaultBook (formerly OfflineBooks US)

> Living checkpoint. Update at the end of every session and after each meaningful milestone. Do not invent values or claim verification without evidence.

## Current status
- Overall status: IN PROGRESS
- Current phase: Phases 1–3 delivered (foundations, Gateway/navigation, F11/F12); Phases 4–6 partly (entry strip, row cursor, design tokens on all screens)
- Current task: ER-design audit follow-up delivered (ERD-001…006, Phase 11, app 1.13.0); next: user to choose ERD-008…010 scope; then import .iif into real QuickBooks Desktop (INV-005), open exports in real Microsoft Excel (XW-007, FR-003/004), QA-002
- Last verified commit/branch: `master` — see `git log` (session 2 commits: VaultBook workspace, refinements)
- Last update: 2026-11-27 (app 1.65.1, data format 8)

## Product goal
Transform the existing application into a coherent, Tally Prime–inspired, keyboard-first US accounting system named VaultBook, preserving its accounting engine, stored data, offline operation, security, and existing features.

## Completed (with evidence)
- AUD-001, AUD-002, AUD-003, AUD-005, FOUND-004 — `docs/AUDIT_BASELINE.md`, `docs/IMPLEMENTATION_PLAN.md`.
- BUG-002 (window tabs discarded unsaved entries) — fixed in `app/js/ui-windows.js`; regression checks in e2e.
- Screen inventory populated from source (34 rows) — `docs/SCREEN_INVENTORY.md`.

## Baseline
- Launch: open `app/index.html` in Chrome/Edge (file://). No server, no build. Verified by e2e.
- Test commands (repo root):
  - `node app/tests/run-node.js`
  - `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"` (Python 3 + Playwright + Chromium)
  - `AXE_JS=<path>/axe-core/axe.min.js python3 app/tests/dev/a11y_audit.py "$PWD/app/index.html"` (axe-core 4.10.2 from npm)
- Baseline results (as received): Node 39/39 pass; e2e crashed at check 65 (stale test steps vs 1.7.0 UI); axe 8 issue types.
- Database/schema: IndexedDB company DB v3, registry v1, data format v3, app 1.7.0.
- Backup/restore: covered by Node tests (round trip, checksum, tamper, encrypted, v2→v3 migration) — pass.

## Session 8 checkpoint (2026-11-05) — 1.14.0 deposits, checks, 1099 forms, write-offs, finance charges
- Files: `js/business.js`, `js/ui-business.js` (new); `js/ledger.js`, `js/invoice-layout.js` (checkPages, stmt1099Pages), `js/ui-forms.js`, `js/ui-planning.js`, `js/ui-gateway.js`, `js/ui-palette.js`, `index.html`, tests (`tests/dev/business_ui.py`).
- Verification: Node 68/68; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22; salestax_ui 30/30; business_ui 18/18.
- Next: 1.15 inventory and fixed assets.

## Session 8b checkpoint (2026-11-05) — 1.15.0 inventory and fixed assets
- Files: `js/inventory.js` (new); `js/schema.js` (v6, invAdjust), `js/ledger.js` (hooks), `js/ui-items.js`, `js/ui-forms.js` (Qty/Cost on purchases), `js/ui-business.js` (adjustment form, fixed assets page), `js/ui-reports.js`, menus, `app/docs/SCHEMA.txt`, tests (`tests/dev/inventory_ui.py`).
- Verification: Node 70/70; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22; salestax_ui 30/30; business_ui 18/18; inventory_ui 20/20.
- Risk: average cost is fixed at posting; back-dated purchases do not re-cost earlier sales.
- Next: 1.16 attachments, tax-line mapping, Customer:Job and billable expenses.

## Session 8c checkpoint (2026-11-05) — 1.16.0 attachments, jobs, billable costs, tax lines
- Files: `js/projects.js` (new); `js/ledger.js` (attachments store, jobs, billable), `js/db.js` (IndexedDB v5), `js/schema.js` (data v7), `js/ui-forms.js`, `js/ui-pages.js`, `js/ui-combo.js`, `js/ui-core.js`, `js/ui-business.js` (attachments card, tax lines page), `js/ui-reports.js`, `js/statements.js`, tests (`tests/dev/projects_ui.py`).
- Verification: Node 73/73; all 12 browser suites pass (projects_ui 14/14).
- Next: 1.17 sales orders, progress & batch invoicing, customer deposits, price levels.

## Session 8d checkpoint (2026-11-05) — 1.17.0 sales orders, progress & batch invoicing, deposits, price levels
- Files: `js/sales.js` (new); `js/schema.js` (salesOrder, data v8), `js/ledger.js` (sourceProgress, srcLine, deposit-funded invoices, priceLevelId), `js/ui-forms.js`, `js/ui-business.js`, `js/ui-pages.js`, menus, tests (`tests/dev/sales_ui.py`; salestax_ui updated for the Create Invoice dialog).
- Verification: Node 77/77; all 13 browser suites pass (sales_ui 14/14).
- Next: 1.18 full sales tax (codes, returns per agency, Pay Sales Tax, exemption certificates) and the remaining reports.

## Session 8e checkpoint (2026-11-05) — 1.18.0 sales tax by agency, Pay Sales Tax, reports (US feature round complete)
- Files: `js/taxreports.js` (new); `js/ledger.js` (components, taxParts, taxAgency, exemptCert), `js/ui-reports.js`, `js/ui-settings.js`, `js/ui-pages.js`, `js/ui-business.js`, menus, `docs/US_FEATURE_AUDIT.md`, tests (`tests/dev/taxreports_ui.py`).
- Verification: Node 79/79; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22; salestax_ui 30/30; business_ui 18/18; inventory_ui 20/20; projects_ui 14/14; sales_ui 14/14; taxreports_ui 11/11. axe NOT RUN.
- Next: user's choice; real-world verification (QuickBooks import, check stock, Excel).

## Session 8f checkpoint (2026-11-05) — 1.18.1 design polish (Impeccable)
- Files: css/theme.css, css/vault.css, css/app.css, css/reports.css (11px floor, stripes, nested cards, dashboard grid, title sizes); js/ui-core.js (nav active: query links win).
- Audit report: docs/DESIGN_AUDIT.md. No data or schema change.

## Session 8g checkpoint (2026-11-05) — 1.18.2 tighter entry screens
- Files: js/ui-entry.js (strip moves into .qbi-tools on invoice-style forms), js/ui-forms.js (col.c-bill), css/app.css, css/vault.css, css/reports.css, css/windows.css (tab strip flex-shrink 0), tests/dev/vaultbook_ui.py (strip checks).
- No data or schema change.

## Session 8h checkpoint (2026-11-05) — 1.18.3 invoice ribbon
- Files: js/ui-forms.js (`qbRibbon`; More menu kept for other forms), js/ui-keys.js (fold button, `#fk-show`, pref `fkeys`), css/app.css, css/vault.css; tests: e2e, inventory_ui, business_ui use ribbon buttons.
- No data change.

## Session 8i checkpoint (2026-11-05) — 1.18.4
- Files: js/statements.js (Desktop labels, totalOf, qbDate/qbRange), js/ui-statements.js (button row, inline fields, corner meta, Hide Header, Collapse Rows), js/ui-combo.js (item source), js/ui-forms.js (item combo), js/ui-keys.js (Esc), js/ui-core.js (dialog keys), js/ui-windows.js (Home/Close), js/designer.js + ui-designer.js (BS default fyToDate), CSS.
- Tests updated: engine (Total label), vaultbook_ui (Esc), inventory/sales/salestax/migrate (pick_item).

## Session 8j checkpoint (2026-11-05) — 1.18.5
- js/ui-core.js: `mnLabel()` underlines a dialog action's `key` letter (Save keeps the Ctrl+S underline); hint paragraph removed.

## Session 8k checkpoint (2026-11-05) — 1.18.6
- css/vault.css: `#main` background = surface; `.tx-page`, `.qbi-page`, `.report-page`, `.rb-page` flush (no padding, no form/article frame).

## Session 8l checkpoint (2026-11-05) — 1.18.7
- js/ui-reports.js: `REPORTS.txdetail`, `RENDER.txdetail` (rebuilds the statement, walks the clicked node; GL rows per account), `def.keep` params survive re-run, `UI.bindRowLinks` on report pages.
- js/ui-statements.js: totals/net/collapsed groups drill to txdetail; row click opens; default `grid` none.
- js/ui-keys.js: row cursor includes `table.sb-table` rows. New test tests/dev/txdetail_ui.py.

## Session 8m checkpoint (2026-11-05) — 1.18.8
- js/ui-keys.js: mousemove (real movement only) sets the `kb-row` cursor; arrow keys enter keyboard mode. Row `:hover` background rules removed from theme/app/reports/vault CSS.

## 1.19.0 checkpoint (2026-11-05)
- CPA-01…CPA-25 done; tests in app/tests/cpa.tests.js (loaded by run-node.js and tests.html).
- node tests/run-node.js: 109 passed, 0 failed (79 earlier + 30 CPA).
- Browser: e2e 192, vaultbook 45, designer 40, migrate 38, workbook 18, invoice 17, qbinvoice 22, salestax 30, business 18, inventory 20, projects 14, sales 14, taxreports 11, txdetail 13, cpa_ui 13 — all 0 failed (505 browser checks).
- Data format 8 / IndexedDB 5 unchanged: every new field is optional (no migration).
- Dashboard bars drill to Transaction Detail (node net:inc / net:exp) for the month.

## 1.20.0 checkpoint (2026-11-06)
- Bank feed: js/bankfeed.js (engine), js/ui-bankfeed.js (page), stores bankLines + bankImports (IndexedDB v6).
- node tests/run-node.js: 124 passed, 0 failed (incl. 18 BF tests).
- Browser: e2e 192, vaultbook 45, designer 40, migrate 38, workbook 18, invoice 17, qbinvoice 22, salestax 30, business 18, inventory 20, projects 14, sales 14, taxreports 11, txdetail 13, cpa_ui 13, bankfeed_ui 32 — all 0 failed.

## 1.21.0 checkpoint (2026-11-06)
- Export: OB.qbexport.bankIIF / bankCSV; Book.recordBankExport / undoBankExport; UI in the Bank feed More menu.
- node tests/run-node.js: 126 passed, 0 failed.
- Browser: e2e 192, vaultbook 45, designer 40, migrate 38, workbook 18, invoice 17, qbinvoice 22, salestax 30, business 18, inventory 20, projects 14, sales 14, taxreports 11, txdetail 13, cpa_ui 13, bankfeed_ui 41 — all 0 failed.

## 1.22.0 checkpoint (2026-11-06)
- Engine: util.js U.smartDate; registers.js OB.registers.build; reclass.js reclassRows/reclassPreview/reclassify/undoReclass (via _raw_saveTransactions, one atomic write).
- Screens: ui-tally.js (dates, chooser, report panel keys, #/vreg, company list keys), ui-reclass.js (#/reclassify), gateway header, ui-keys.js row cursor.
- Tests: tests/tally.tests.js TP-01…05; tests/dev/tally_ui.py.
- node tests/run-node.js: 131 passed, 0 failed.
- Browser: tally_ui 32, e2e 192, vaultbook 45, designer 40, migrate 38, workbook 18, invoice 17, qbinvoice 22, salestax 30, business 18, inventory 20, projects 14, sales 14, taxreports 11, txdetail 13, cpa_ui 13, bankfeed_ui 41 — all 0 failed.

## 1.23.0 checkpoint (2026-11-06)
- Engine: js/bankplus.js (rules v2: B.ruleMatches/splitFor/normRule, rulePreview; bankCandidates + deposit/group; postBankLine deposit/group; bankBooksPairs, _matchToBooks, importBankLines matchBooks/autoAdd; bankPreview inBooks/autoAdd); ledger.js finishReconciliation opts.adjust, _reconSnapshot, reconReport, undo voids the adjustment; qbexport.js group links.
- Screens: ui-banking.js (rule editor v2, rules list, reconcile find/adjustment, #/recreport/:id); ui-bankfeed.js (import preview, deposit/group candidates, rule splits, Already in books badge).
- Tests: tests/bankplus.tests.js BP-01…09; tests/dev/bankplus_ui.py; bankfeed_ui.py and BF-03/05 opt out of matchBooks to keep testing the manual path.
- node tests/run-node.js: 140 passed, 0 failed.
- Browser: bankplus_ui 15, tally_ui 32, e2e 192, vaultbook 45, designer 40, migrate 38, workbook 18, invoice 17, qbinvoice 22, salestax 30, business 18, inventory 20, projects 14, sales 14, taxreports 11, txdetail 13, cpa_ui 13, bankfeed_ui 42 — all 0 failed.

## 1.24.0 checkpoint (2026-11-09)
- Engine: js/qbimport.js — Q.sheetRows (SheetJS worksheet → rows, constant formulas as numbers), qboSniff (title row), qboJournal, qboLedger (+groupsToTxns shared with the Desktop ledger), qboStatement (Total-driven heading stack → type + parent), qboTrial, qboAccountList, qboContacts, qboMerge; Q.detect(name, text, isPdf, rows); Q.read accepts { name, rows }; plan uses QBOBAL (debit +) as the expected balance, model.employees → vendors with a note, QBO-specific missing-account errors, record.from 'QuickBooks Online'.
- Screens: ui-migrate.js reads .xlsx/.xls with the bundled SheetJS (sheetStubs so formula cells without a stored value are kept), UI.companyFromQuickBooks(files) creates the company named by the reports and opens #/migrate with the files pending; ui-pages.js "Create from QuickBooks files" (#qb-newco), ui-tally.js Alt+Q.
- Tests: node 147; qbo_ui 15; migrate_ui 38, tally_ui 32, vaultbook_ui 45, bankfeed_ui 42 re-run.
- Proven on one real QuickBooks Online client set (8 Excel files, 6,938 transactions, 69 accounts): every balance equal to its Trial Balance. No client data is in the repo.

## 1.25.0 checkpoint (2026-11-10)
- Engine: reports.js R.home(book, asOf, {days}) — 30-day P&L with change, expenses top 3 + Other, invoices overdue/not due/paid/undeposited, bills open/due within 7 days, banks with bank balance and lines to review.
- Screens: js/ui-studio.js (top bar period + New wiring, Banking badge after every render, UI.homeTabs on Gateway and Dashboard, routes.dashboard = Business overview widgets keeping dash-chart/kpi testids, UI.newMenu = grouped menu with filter, arrows, Enter, F-keys, recent duplicates); index.html top bar (#st-period, #st-new, search label); css/studio.css loaded last (tokens + component restyle, light and dark); ui-bankfeed.js tab label Categorized.
- Tests: node 149; studio_ui 26; all other browser suites re-run green (e2e 192, vaultbook_ui 45, tally_ui 32, bankfeed_ui 42, bankplus_ui 15, migrate_ui 38, qbo_ui 15, salestax 30, txdetail 13, designer 40, invoice 17, qbinvoice 22, business 18, inventory 20, projects 14, sales 14, taxreports 11, cpa 13, workbook 18).
- Fonts: system UI font (Segoe UI on Windows); the mock-up's web font is not bundled because the app stays offline.

## 1.25.1 checkpoint (2026-11-10)
- ui-tally.js: monthChart() under Sales/Purchase month table; side panel hidden unless prefs vregSide or a filter is on; #vr-side-t toggle; Ctrl+F opens it. ui-gateway.js: root menu trimmed, new 'company' sub-menu, Recurring/Reclassify under Vouchers, backup alert removed. ui-studio.js: no backup banner, no key hints in home tabs, chart viewBox 1200×150. css/studio.css: .vr-chart, .vr-side[hidden], sidebar key hints hidden.
- Tests: node 149; studio_ui 40; every browser suite re-run green.

## 1.26.0 checkpoint (2026-11-10)
- Engine: bankfeed.js Book.updateBankLine(id, {note, date}) (For review only; bankDate keeps the bank's date); statements.js R.statementChart(st).
- Screens: new js/ui-nav.js (bookmarks per company in prefs 'bookmarks:<companyId>', UI.toggleBookmark, UI.editBookmarks, UI.gearMenu, UI.setCompactNav, pref navCompact → html.nav-compact); ui-keys.js Ctrl+Alt+letter (AltGr-safe), Ctrl+Alt+/, Ctrl+D; ui-flyout.js flyouts placed at the side menu's edge; ui-bankfeed.js Posted tab, Date and note in the opened line; ui-statements.js modern bar (pref reportLayout, 'classic' keeps the old toolbar) and chart (pref reportChart); ui-studio.js home Customize (pref homeWidgets) and Privacy (pref homePrivacy); ui-pages.js contact hub tabs (?tab=statements|details|notes); ui-forms.js formPreview side panel (OB.invoiceLayout pages from b.normalize(gather())).
- Tests: node 151; qbo26_ui 29; studio_ui 40 (company sub-menu wait fixed); every browser suite green.

## 1.26.1 checkpoint (2026-11-11)
- Client report: a May deposit ($370,074.75) paid two open invoices; only single exact invoices were suggested and there was no manual pick.
- Engine: bankplus.js candidates (c) — per contact named in the bank text (mentioned(): first two significant words, spaces ignored) or whose invoice numbers appear in it, B.subsets over open items dated up to 5 days after the bank date; Book.bankOpenDocs(lineId, contactId?, all?); bankfeed.js draftFor 'open' takes amounts {txnId: cents} (0 < amount ≤ open balance).
- Screens: ui-bankfeed.js manualPick()/manualSum() in Find match; multi-invoice candLabel.
- Tests: node 152; qbo26_ui 37; every browser suite green.

## 1.26.2 checkpoint (2026-11-11)
- Client report: customers split invoices across days (Dignity Health 09/22 $9,750 + 09/23 $5,250 = one $15,000 invoice); must not be amount-only.
- Engine: bankplus.js candidates (d) split:true {txnIds:[inv], amounts:{inv: line amount}, peers:[lineIds]} — contact mentioned() in every line, peers ≤ 60 days, invoice date ≤ earliest line + 5, B.subsets over peers (1–4); score boost +6 for an invoice number in the bank text on single 'open' candidates, +3 for the named contact; ties sorted oldest item first.
- Screens: ui-bankfeed.js candDraft passes amounts; Split badge and label.
- Tests: node 154; qbo26_ui 40; every browser suite green.

## 1.27.0 checkpoint (2026-11-12)
- Research: QuickBooks Desktop Find (Simple/Advanced, header fields only), QuickBooks Online global search with phrases and Advanced transactions search (two-year blocks), Xero Find & Recode (up to 9 conditions, no description search), TallyPrime Find (field syntax, Filter Details), Zoho Books advanced search and custom views.
- Engine: new js/find.js (OB.find: FIELDS, OPS, find, parse, describe, everything).
- Screens: new js/ui-find.js (#/find?tab=all|simple|adv, q=, c=<criteria JSON>, sort=); Ctrl+F key 'find' (not on screens whose reportCtl has filter); ui-palette.js 'Search all company data' row; gear Tools > Find; prefs findSaved:<companyId>.
- Tests: node 158; find_ui 21; every browser suite green.

## 1.27.1 checkpoint (2026-11-12)
- Bug: ui-bankfeed.js toggle() opened the review panel for any row; plans (candidates) are built only on For review, so detail() read p.cands of undefined. Fix: toggle() goes to the line's transaction for non-review lines; the detail row renders only when a plan exists.
- Tests: node 158; qbo26_ui 42; bank suites green.

## 1.27.2 checkpoint (2026-11-12)
- User: VaultBook's reconciliation report was poor; reference QuickBooks Reconciliation Detail PDF.
- Engine: new js/recon-report.js (OB.reconReport.model(book, recId, {view}), groups, matrix) builds an OB.reportModel model; report-model.js toPdf gains model.portrait and model.overflowLabels (headings run across empty cells; label width set by transaction rows only) and draws kind 'note' rows full width.
- Screen: ui-banking.js routes.recreport renders the model (Detail/Summary), glance strip, Download PDF (M.toPdf), Excel (M.toSheet), CSV (RR.matrix), Print.
- Tests: node 159; bankplus_ui 19; every browser suite green.

## 1.27.3 checkpoint (2026-11-12)
- User: May bank lines auto-matched to invoices in VaultBook; after IIF export/import the invoices stayed open in QuickBooks.
- Cause: payments option 'deposit' wrote DEPOSIT with an A/R split (unapplied credit in QuickBooks). IIF cannot link payments to invoices (Intuit).
- Fix: qbexport.js payments 'payment' → TRNSTYPE PAYMENT / BILLPMT, memo X.appliedText; X.paymentList(book, opts) rows + CSV; ui-bankfeed.js default 'payment', 'deposit' removed from the UI (engine keeps it for old callers), apply list panel and downloads.
- Tests: node 160; qbo26_ui 46; every browser suite green.

## 1.28.0 checkpoint (2026-11-12)
- User: wants payments sent to QuickBooks Desktop to close their invoices; chose the direct script over Web Connector (QuickBooks Accountant Desktop Plus 2024).
- Engine: qbexport.js X.connectorBatch(book, opts) built on paymentList (customer payments only; amounts as 2-decimal strings; names via opts.names).
- Screen: ui-bankfeed.js export panel button bfx-qbbatch (onlyNew false, chosen period).
- Tool: app/tools/VaultBook-QB-Connector.ps1 (QBXMLRP2 COM, relaunches in 32-bit PowerShell if needed; AccountQuery, ReceivePaymentQuery duplicate guard, InvoiceQuery by RefNumber + customer, ReceivePaymentAdd with AppliedToTxnAdd), two .cmd launchers. Not runnable in this sandbox.
- Tests: node 160 (BF-27 inside BF-26); qbo26_ui 47; bankfeed_ui 42.

## 1.29.0 checkpoint (2026-11-12)
- User: MIS report of when invoices are created and paid, days and averages, all invoice and payment data, standard layout with fields to add/remove. (QuickBooks connector screen approved but waits until after this.)
- Engine: new js/paydays.js OB.payDays (report, FIELDS, DEFAULTS, fields, items, totals, value, matrix). Days from Book.incoming + appliedOn, open via openBalanceAsOf(asOf).
- Screen: ui-reports.js REPORTS.paydays (fields: true → Fields button instead of Columns; data-rp toolbar fields; out.toolbar/out.bind hooks in routes.report), RENDER.paydays; prefs paydaysFields:<view>.
- Tests: node 164; mis_ui 12.

## 1.29.1 checkpoint (2026-11-12)
- User: drill-down in the report, and Excel grouping the same way; then: one drill level only (customer → invoices with payment info on the row), plus expand all.
- Engine: paydays.js P.drill (level 0 customer, 1 invoice; invoice rows carry firstPayDate, lastPayDate, payNos, payments, depositTo), FIELDS/DEFAULTS.drill, matrix first cell {v, depth}.
- Report model: fromMatrix keeps first-cell depth (model.outline); toSheet writes rowMeta levels and summaryAbove; xlsx.js outlinePr summaryBelow=0 when summaryAbove.
- Screen: default view drill; rows collapse with visibility: collapse (column widths stay); Expand all customers / Collapse all.
- Tests: node 166; mis_ui 19; designer_ui 40, workbook_ui 18, bankplus_ui 19, txdetail_ui 13.

## 1.29.2 checkpoint (2026-11-12)
- User: a field for the income accounts used on each invoice (e.g. "43700 Income:Fee for Professional Services"), all of them when several.
- Engine: paydays.js per invoice income map from splits of income/oi accounts (−amount); x['inc:<id>'], incomeText, incomeCount; customers/total sum; r.incomeAccounts; P.incomeFields, P.allFields(view, r); P.fields/matrix take r.
- Screen: ALL = P.allFields; stored field keys validated against it; list fields show one item per line (.pd-li).
- Tests: node 167; mis_ui 22.

## Planned future version (recorded 2026-11-12)
- Payroll from paystubs with local AI: Paystub Lab first, then layout reader, optional small text LLM and vision models (local, suggest-only), math checks, per-company learned layouts, gross-up journal entry. Details: IMPLEMENTATION_PLAN.md "Future version — Payroll from paystubs with local AI".

## 1.30.0 checkpoint (2026-11-12)
- User: approved the Send to QuickBooks Desktop design (one double-click script that checks, asks Y/N before creating customers/items, records; item matched by exact or leading name with the full description printed; bills later).
- Engine: js/qbsend.js OB.qbsend (sendList, batch v2, applyResult; Book.saveCompanySent → company.qbSent[txnId] = {qbTxnId, at} | {problem, at}).
- Screen: js/ui-qbsend.js #/qbsend; nav link in Banking; gear Tools and palette entries.
- User rule: the script never searches Downloads; it asks for the file (Open File dialog / typed path / drag onto .cmd) and saves results next to it.
- Script: tools/VaultBook-QB-Send.ps1 (qbXML 13.0: Customer/Item/Account queries, CustomerAdd, ItemServiceAdd, InvoiceAdd with lines, ReceivePaymentAdd + AppliedToTxnAdd; dup checks; result JSON+CSV; 32-bit relaunch; writes the result even after a mid-run failure). Review fixes applied: terms retry on 'Terms' error, 11-char RefNumber, 41-char Addr lines, ref in payment dup check, banner once, bad path.
- Tests: node 170; qbsend_ui 16; e2e 192, vaultbook_ui 45, studio_ui 40, qbo26_ui 47, bankfeed_ui 42.

## 1.31.0 checkpoint (2026-11-12)
- User: "start" on the Read step; rule: script never searches Downloads, always asks for files.
- Engine: js/qbsync.js OB.qbsync (TYPES map, compare, gap, remember). Snapshot format v1 in SCHEMA.txt.
- Screen: ui-qbsend.js Months tab (default) + Items tab; snapshot kept in prefs qbSnapshot:<companyId>; Load button accepts snapshot or result.
- Script: tools/VaultBook-QB.ps1 + VaultBook QuickBooks.cmd (menu; Read via *QueryRq per type with TxnDateRangeFilter; Memo marker [VB:key] on sent txns; Cycle reads again). Old 1.28/1.30 scripts and launchers removed.
- Tests: node 174; qbsend_ui 23; e2e 192; vaultbook_ui 45.

## 1.32.0 checkpoint (2026-11-12)
- User: import everything from QuickBooks into VaultBook first time; one dedicated section for all QuickBooks options and reports; make the connector look like classic software.
- Engine: js/qbfull.js (toModel → importer model with qbTxnId + links; fullSummary; tieOut). qbimport.js detects kind 'qbfull', applyPayments uses links first (stats.linked), importRef carries "TxnID x". qbsync.compare matches by importRef TxnID (how 'txnid').
- Screens: js/ui-qbd.js (#/qbd overview, #/qbd/tieout); UI.migrateFiles; UI.qbLoadFile shared loader; prefs qbFull:<companyId> saved on import. Side-menu group "QuickBooks Desktop".
- Script: VaultBook-QB.ps1 menu option 5 Export (XObj generic XML→JSON, JW StringBuilder writer, per-type first-date probe then per-year queries), console kit (Banner/Menu/Box/Progress/Ask). Review fixes applied.
- Tests: node 178; qbd_ui 13; qbsend_ui 23; migrate_ui 38; e2e 192; vaultbook_ui 45; studio_ui 40; qbo26_ui 47.

## 1.33.0 checkpoint (2026-11-12)
- User: drop paystubs, VaultBook passes the payroll JV automatically (weekly, bi-weekly, monthly); will send other paystub layouts later to extend it.
- Engine: js/paystub.js (OB.paystub: amountCandidates, classify with learned labels, parse rows → stubs with copies merged and a totals solver, check/retotal, frequency, settings/savePayroll on company.payroll, learnFromJournal, employer, journal, posted, ytdGap).
- Screens: js/ui-payroll.js (#/payroll tabs stubs/settings/posted); statement-engine gains ocrImageRows. Side-menu group "Payroll".
- Layout support so far: EARNINGS / TAXES / MISC DEDUCTIONS with CURRENT and YTD columns (payroll-service stub printed twice per page). New layouts: add rows from their OCR to tests and extend header/cells.
- Tests: node 187; payroll_ui 27; qbd_ui 13; qbsend_ui 23; mis_ui 22; studio_ui 40.

## 1.33.1 checkpoint (2026-11-13)
- User: a small universal HTML tool: upload paystub → JE with memo → download .iif for QuickBooks; account mapping typed by hand or created through the .iif; flexible for ADP and other payroll layouts later.
- tools/paystub-iif/PaystubToIIF.src.html + build.py → one offline file (~11 MB). Uses OB.paystub (parse, journal with a name-keyed fake book, toIIF). Settings in localStorage 'paystub-iif.v1'.
- Future (recorded): learn ADP/Paychex/Gusto/hourly layouts from the user's samples.
- Tests: node 188; paystub_iif_ui 15; payroll_ui 27.

## 1.34.0 checkpoint (2026-11-13)
- User: clients give any payroll information; the system must recognise what each document is, what is needed and what is not, understand the concepts and cross-verify across everything.
- Engine: js/paydocs.js (OB.paydocs: read, readFile, stubDoc, reconcile, reportHTML, CSS, personKey). Kinds in D.KINDS with role entry/payment/verify/ignored. Never keeps SSN/EIN/account numbers.
- statement-engine.extractRows adds AcroForm widget values as text items.
- Screens: ui-payroll.js (st.docs, cross-check card), tools/paystub-iif (same).
- Tests: node 192; payroll_ui 29; paystub_iif_ui 20.

## 1.34.1 checkpoint (2026-11-13)
- User: option to merge all 20 paystubs into one entry in the tool. Done: Entries select (S.merge in localStorage), P.mergeDrafts. Client Jan–Oct merge = 24 lines, totals equal the register.

## 1.35.0 checkpoint (2026-11-13)
- User: blend the whole Paystub-to-IIF tool into VaultBook: post the JV in the books and download the .iif.
- ui-payroll.js: st.skip ticks, actionBar (prefs payrollMerge:/payrollIifCreate:<companyId>), combined preview, post(merge), downloadIIF (VaultBook full names, OB.qbexport.ACC types, toAnsi). P.posted reads every date in a combined importRef.
- Tests: node 193; payroll_ui 38; paystub_iif_ui 23.

## 1.36.0 checkpoint (2026-11-13)
- User asked for a full design critique, then "fix all of it", direction "Dense ledger" (Tally-like density, flat controls, keep amber bar and F-keys).
- studio.css is the look's authority: radius tokens 3-4px, no card shadow, .btn 28px, table td 4px 8px, amounts 1em (theme.css:74 removed), titles 18px/600, sentence-case labels, rr-glance one-line strip, status badges as text in tables, themed chart colours.
- JS: form autofocus + chips tabindex -1 + grow-lines listener + save bar right (ui-forms); retry only for storage errors (ui-core); menu highlight by transaction type (ui-core); filtered list title; customers empty columns/Receive payment; dashboard uses UI.currentPeriod via R.home(opts.from/to); report list one line; window layout default 'tabs'.
- Tests: node 193; e2e 192; studio_ui 40; qbinvoice_ui 22 (updated for 3 lines, Customer:Job); cpa_ui 13 (blur before scripted customer); all other suites pass.

## 1.37.0 checkpoint (2026-11-13)
- User ran Send for May although 13 payments exist in QuickBooks as Deposits: 1 duplicate payment recorded (Baycare 26,400.00 05/28, TxnID BB5-1794599395) then QuickBooks crashed ("Unexpected error, check qbsdklog.txt"). User must delete that duplicate in QuickBooks.
- Script: Mode Reports (DoReports, RunReport, PickAccount, PickPeriod, ParseDay/ParseMonth, CsvLine), deposit guard ($depCache/$depUsed), $stopped handling, Menu title param. PowerShell cannot run in this sandbox: bracket/quote scanner only.
- VaultBook: qbsync.compare matches payment to Deposit by date+amount.

## 1.37.1 checkpoint (2026-11-13)
- User bug: bank export From date jumped away after the first year digit (07/01/0002). Cause: Chrome fires change per year digit; handlers re-rendered. Fix: OB.util.dateCommit in ui-bankfeed, ui-pages (iif), ui-business (paysalestax), ui-payroll, ui-migrate, tools/paystub-iif. New date boxes that redraw must use U.dateCommit.

## 1.38.0 checkpoint (2026-11-13)
- User: send all bank transactions, excluding what the QuickBooks snapshot already has; all selected or selected months.
- qbsend.js: BANK_TYPES check/expense/deposit/transfer/journal/ccCredit shaped from splits; batch v3. ui-qbsend: kinds invoice,payment,bank; account param. Script: $bank plan objects carry .b and .xml.
- qbXML element order used (unverified live): CheckAdd AccountRef,PayeeEntityRef,RefNumber,TxnDate,Memo,IsToBePrinted,ExpenseLineAdd; CreditCardChargeAdd AccountRef,PayeeEntityRef,TxnDate,RefNumber,Memo,ExpenseLineAdd; DepositAdd TxnDate,DepositToAccountRef,Memo,DepositLineAdd(EntityRef,AccountRef,Memo,Amount); TransferAdd TxnDate,From,To,Amount,Memo; JournalEntryAdd TxnDate,RefNumber,lines(AccountRef,Amount,Memo,EntityRef).

## 1.38.1 checkpoint (2026-11-13)
- User's 5 QuickBooks Desktop files (chart IIF, vendor IIF, GL CSV, BS/P&L PDF) failed to import: GL section "X - Other" for a sub-account was not resolved (only full names were tried). Fixed in qbimport.resolveAccount via leafIndex. Client files stay out of the repo.

## 1.38.2 checkpoint (2026-11-16)
- User's connector full export failed on Invoice 1002 (due 10/02, dated 10/03) and its payment. qbimport dueOf clamps and warns. Real file: 583 transactions, tie-out ok. Aging report redesign is at mockup stage, awaiting approval (views Summary/Detail/Grouped, invoice date range, custom periods, Excel summary/detail/both, statements now-or-later).

## 1.39.0 checkpoint (2026-11-16)
- User asked for layout options for BS/P&L, saw 12 mockups + 3 drill-down modes, then said "do something useful". Built the 7 looks that need no new markup (reports.css look-*), in the existing View menu. Not built: two-sided (T-format), boxed sections, stepped columns, big totals, side panel, month-cell drill. Aging report redesign still awaits approval.

## 1.40.0 checkpoint (2026-11-16)
- User: layouts 1-12 as a company setting, three main ones on the report, PDF and print must follow, alignment perfect. Built. stmtView.look '' = company layout. The stepped span class is .stp (.amt clashes with app styles). Formal PDF uses Times (no bold face in pdf.js). Checked by rendering all 24 PDFs and screen shots.

## 1.40.1 checkpoint (2026-11-16)
- User changed the company layout and reports did not change: stmtView.look (sticky, also written as 'classic' by 1.39 whenever any view pref was saved) overrode it. Replaced by prefs stmtLook {k, co}; old stmtView.look is ignored.

## 1.41.0 checkpoint (2026-11-16)
- Printing: capture-phase click/keydown in ui-core clicks the visible [data-x=pdf] with UI._printMode; exportMatrix then prints via a hidden iframe (blob PDF). Not verified with a real print dialog (headless has no PDF viewer).
- User's 8 QBO xlsx files (Radiology MSO): failed on Accounts Receivable (A/R) missing from BS/P&L. Now 733 transactions, 52 balances equal.

## 1.41.1 checkpoint (2026-11-16)
- User pointed out the General Ledger shows where an account belongs. The QBO GL has no type labels but keeps chart order; model.qboOrder now bounds the type of zero-balance accounts (exact when both neighbours agree; else name hint within range; else Other Current Asset if in range).

## 1.42.0 checkpoint (2026-11-16)
- User approved the Intelligence panel and asked for it to be "more advanced" with a small LLM. Built rule-based engine (DEC-041) with compare/why/by-month/top/follow-ups/typo-tolerant names, and an optional hook to the browser's built-in on-device model (slots only). No model is bundled: none can be fetched or tested in the build sandbox and it would break the no-dependency rule.

## 1.42.1 checkpoint (2026-11-16)
- Design hook flagged the side-stripe on .vi-a; replaced with a hairline between answers.

## 1.43.0 checkpoint (2026-11-16)
- User's IT-staffing company (QuickBooks Premier): chart IIF (as of 11/16/2026), vendor IIF, GL CSV (12/31/2014-12/31/2024, P&L detail only for 2024, 14 Closing Entry lines), BS PDF 12/31/2024, P&L PDF Jan 2010-Dec 2024. Result: 10,771 transactions; all 136 non-RE ledger section totals equal; BS PDF 8/8, P&L PDF 59/59. Earlier client sets re-run clean. Client files are in /tmp only.

## 1.44.0 checkpoint (2026-11-17)
- User's leather-goods company: GL PDF (128 pages, as of 12/31/2025, printed 07/22/26), BS and P&L PDFs (printed 08/18/26). Result: 2,762 transactions, all 130 account balances equal the ledger PDF's own totals. Statements differ on 15 + 19 lines because they were printed 27 days later (ledger Sales 13.18M vs P&L 20.47M). The PDF ledger is fed to the normal CSV path as a generated CSV plus a generated chart IIF (HDR PROD 'QuickBooks General Ledger (PDF)').

## 1.45.0 checkpoint (2026-11-18)
- Extra help trial. Real data, NitoSoft 2024 lines with a new payee (211): Common merchants identified 11, 9 right; Other clients (motel + Milwaukee books) identified 0 — different industries share almost no merchants. Autopilot backtest with last-2-years habit and no auto-post to owner/loan/payroll/liability accounts: 61% auto at 96.2% right (99.9% by $), not built yet.

## 1.45.1 checkpoint (2026-11-18)
- Merchant lists from the user (3 DeepSeek files, 12,340-row CSV) screened: banks, payroll, car makers, invented abbreviations, generic words, place names and duplicates removed; 1,161 added. On NitoSoft: 2024 identified 182 of 902 (was 179), 86% equal to the booked account; 2015-2023 1,700 (was 1,597). The bigger list adds little for this client; the remaining misses are client habits (Costco to the shareholder loan).

## 1.45.2 checkpoint (2026-11-18)
- Extra help run on every real company here (NitoSoft 10,775 txns, motel, Milwaukee, radiology QBO, sample, empty), no errors, 10,615 lines in about 1 s. Common merchants equal to the booked account: motel 36/36, radiology 80/90, NitoSoft 1,568/2,272 (misses mostly the owner's purchases booked to the shareholder loan). SHAF not run (PDF-only books need the browser reader).

## 1.46.0 checkpoint (2026-11-18)
- Close the books built. Self-test on real books (habits filed under payee name and bank wording): NitoSoft 2024 902 lines, 41% sure at 94.3% right, suggestions with the right account in the top three 80%, 37% new payees; misses mostly Shree Capitals moving from consulting fees to the shareholder loan in 2024. Motel and radiology too short a history to learn from.

## 1.47.0 checkpoint (2026-11-18)
- Update QuickBooks built. On the real client (Tobacco and Candy of North NJ, export 2026-11-18): all 4,442 VaultBook transactions linked; 905 edits found (900 checks, 5 deposits), 0 voids, 5 new accounts (Sales:Sales Returns, Software / Subscriptions, License, Miscellaneous Expense, Credit Card), 1 QuickBooks-only entry left alone. The connector's new parts are untested on Windows here.

## 1.47.1 checkpoint (2026-11-18)
- Excel and CSV bank imports: 13 layouts pass both ways. The user's 2026 Bank of America workbook (10 statements, 1,354 rows) imports 1,329 lines (25 zero fee waivers skipped); money in ties every month; money out is 0.01 over each month because of the file's 10 'Interest Earned -0.01' rows, which the statements' own totals and balances do not include.

## 1.48.0 checkpoint (2026-11-19)
- Paste entries built: a grid on any ledger takes rows copied from Excel (QuickBooks report layout or plain cells), repeats them monthly, creates missing accounts and names, and posts them in one atomic write through the QuickBooks import's type rules.

## 1.48.1 checkpoint (2026-11-19)
- Paste entries splits one amount over several accounts from Excel: blank-date lines, Entry #, or a Split cell listing accounts by amount or percent; Join into one entry in the grid.

## 1.49.0 checkpoint (2026-11-19)
- Doc Center built: inbox of unattached files, reading of file names and PDF text, matching and bulk attach, missing documents, clean up, CPA package zip. Scanned images are not read (no OCR here); their names are.

## 1.50.0 checkpoint (2026-11-19)
- Calendar built: month/week/agenda, cash forecast with low warning, federal deadlines by return type with weekend/holiday shift (state sales tax by agency setting), actions, to-dos, reminders, .ics.

## 1.50.1 checkpoint (2026-11-19)
- Calendar rebuilt to work like a desktop calendar: click-to-add, pointer dragging of one or many items, Day/Week hour grid with draw, move and resize, popovers, undo, keyboard shortcuts, timed reminders. Pages can now take Esc with [data-overlay] (ui-keys).

## 1.50.2 checkpoint (2026-11-19)
- Report date typing fixed at the root (U.dateCommit used keyboard timing, not focus). Duplicate audit acted on: forecast report built from OB.cal; single spreadsheet from the reader goes to the Bank feed column step; Reclassify under Books; dead dashboard code removed.

## 1.50.3 checkpoint (2026-11-19)
- Typed report dates apply by themselves once complete (year 1900-2100, 0.7 s pause), focus returns to the box.

## 1.50.4 checkpoint (2026-11-19)
- Rule from the user: no instruction notes on screens or reports unless a user could not figure it out. UI.page subtitles now need { html } (only data). Menu bar redesign: Version D1 and D2 on the design canvas, not built yet.

## 1.56.0 checkpoint (2026-11-20) — review fixes (Impeccable critique + audit)
- Done: everything in the 2026-11-20 critique (`.impeccable/critique/2026-11-20T21-02-24Z__app-index-src-html.md`): payment auto-apply and unapplied-credit question; dialog focus trap, inert background, Esc guard, z-order; one save-button row on all entry forms; Settings fixes (unknown tab, inline save error, photo logos, sales tax retry, switches act at once); tab de-duplication and restore cap; Reports finder; View can hide toolbar / F-key panel; phone tables scroll in their box, save bars above the tab bar, one-row Settings tabs and type keys, VaultBook blue on phone, bank feed accounts as desktop; first-run checklist and copy; Gateway hints; contrast and focus fixes. See DEC-046 and CHANGELOG 1.56.0.
- Tests: Node 266/266 (new: company name limit). Developer UI tests 34 run, all pass (including qbinvoice_ui 22/22 updated for Ctrl+S = Save, menubar_ui 17/17, vaultbook_ui 45/45, studio_ui 40/40, payroll 38/38). paystub_iif_ui NOT RUN (needs tools/paystub-iif). e2e: 182 checks pass, then the run stops at the encrypted-backup download with "browser has been closed" — the unchanged 1.55.2 code stops at the same step in this environment (system Chrome, no Playwright Chromium), so not caused by this change; NEEDS VERIFICATION on a machine with Playwright's Chromium. Browser checks of each fix: 28/28 (desktop, phone, dark).
- Risks: Ctrl+S on the invoice now saves and stays (was Save & Close); phone colours need the user's eye on a real iPhone.
- Next action: run the full e2e with Playwright Chromium; the user reviews phone colours and the payment flow.

## 1.51.0 checkpoint (2026-11-20)
- The user chose Version F from the design canvas: the D1 menu bar and toolbar with the mixed style. Built as js/ui-menubar.js (no new routes; every item points at an existing screen). The old K/Y/O/X/P bar stays in the page, invisible, so its keys and menus work; File opens them.
- Side menu hidden once on first start (pref menubarSeen); landing page and Esc fallback are #/dashboard. Tokens in css/studio.css are now grey with blue #2452c7 (dark: #7fa2f5).
- Not done: the dashboard widgets were restyled only through tokens, not rebuilt to the demo layout; fonts stay the system fonts (no network).

## 1.57.0 checkpoint (2026-11-23) — Bank feed uses the books' history
- The user's complaint: the Bank feed offered nothing from 11 years of QuickBooks history, had no visible sort, and suggestions could not be ticked and posted together. The Close the books engine (habits, payee reading) already existed; it is now what the Bank feed asks (OB.close.forFeed), after rules and last-time history.
- Measured on the user's own file (kept outside the repo): 1,329 bank lines for 2026 against books of 11,608 entries. Before: 259 sure, 460 to check, 157 common, 443 nothing (and only inside Close the books). After: 509 sure, 479 to check (412 habit + 67 common), 341 nothing. Self-test on 2025 (learn from earlier years): 383 sure lines, 362 right (94.5%); 241 suggestions, 207 right.
- The 341 with nothing are payees that are not in the books (new in 2026). The same-payee select is for those.
- Speed fixes were needed for a file this size: bankCandidates is memoised per line until reindex; bulk post plans first.
- Not done: auto-post on import (still a person's click); a merchant list for groceries, gyms, government fees; learning across a firm's clients beyond "Other clients".

## 1.58.0 checkpoint (2026-11-24) — Send to QuickBooks from a date
- The user asked for one step: give a date, send everything from it, skip what QuickBooks has. The pieces existed (send list, batch, the connector's own duplicate check); added Q.fromDate and a From a date tab.
- Found on the user's company: the 11,607 entries imported from QuickBooks showed as Not sent, so a wide date would have offered them all back. They now count as already in QuickBooks through the TxnID in importRef.
- The PowerShell connector was not changed (it cannot be tested here).

## 1.59.0 checkpoint (2026-11-24) — Send by period, straight to the tool
- The user wants the connector to take the data from VaultBook itself and to choose a date, a period (12 months) or custom dates. The link built for Update QuickBooks (127.0.0.1:47321, action apply) already accepts any vaultbook-qb-batch, so the By date tab posts its batch there and applies the returned result. No PowerShell change.
- Tested with a stand-in for the tool in the browser test; not run against real QuickBooks.

## 1.60.0 checkpoint (2026-11-24) — Connector menu
- The user found the connector menu confusing (screenshot of the 8-line menu). Reordered by intent: Connect first, then the two directions, preview, snapshot, reports, setup. Cycle mode left the menu but -Mode Cycle still works.
- Only the menu array, the pick-to-mode switch, the start box, two messages and the header comment changed in the script. It could not be run here (no PowerShell).

## 1.60.1 checkpoint (2026-11-24) — parse error on the first real send
- The user's first linked send of 1,329 bank entries stopped at entry 1: "error when parsing the provided XML text stream", 0 recorded. 1,302 of the 1,329 memos held U+2014 from the Bank feed description. Fixed in VaultBook (U.qbText in the batch) and in the script's X().
- Not confirmed on Windows yet; the cause is inferred from the message and the data.

## 1.61.0 checkpoint (2026-11-25) — QuickBooks stopped after 54 of 1,329
- The 1.60.1 character fix worked (entries recorded). Then QuickBooks itself stopped ("Unexpected error. Check qbsdklog.txt") at entry 55 of a file send. Cause not known (no log seen); QuickBooks Desktop is known to stop under long runs of SDK adds.
- Answer: VaultBook drives the send in parts of 25 through the link, each part a new tool process and QuickBooks session, results applied per part, resume by pressing Send again. The script change is three lines (yes for later parts, version, a longer pause).
- Not verified on Windows. If QuickBooks still stops often, lower Q.CHUNK or raise Q.REST_MS, and ask for qbsdklog.txt.

## 1.62.0 checkpoint (2026-11-25) — .iif for a period
- QuickBooks stopped during long connector sends; the user asked for an .iif of all bank transactions for a chosen period. The Bank feed already had an .iif export (bank lines only, its own exported marks); the new button on By date takes any bank transaction of the period that is not in QuickBooks, and asks afterwards before marking (company.qbSent[id] = { qbTxnId: '', iif, at }).
- On the user's 2026 draft: 1,329 transactions, 1,182 checks and 147 deposits, 468 KB, 0 characters lost.

## 1.63.0 checkpoint (2026-11-25) — wrong check numbers in QuickBooks
- After the linked send, QuickBooks showed checks numbered 9001, 9002... that had no number in VaultBook: CheckAdd without RefNumber takes the next check number. Now an empty RefNumber is sent for checks (expected to stay empty; not verified).
- The user asked to delete a date range from QuickBooks. Built as option 8, limited to entries with the [VB:] mark, typed DELETE, removal record back to VaultBook.

## 1.64.0 checkpoint (2026-11-25) — .iif from reports
- The user asked for .iif beside CSV/Excel/PDF/Print on the General Ledger, with a tick box on each entry, select all in the period, and an indicator while the file is made. Built generically in ui-reports.js: any report row that links to an entry gets a box.
- The file is the same writer as By date and the Bank feed (txnsIIF, invoicesIIF), so the [VB:] mark and plain text apply.

## 1.65.0 checkpoint (2026-11-27) — Citi card statements
- The user attached a Citi Costco Anywhere Visa Business statement and asked for support in VaultBook and Statement Studio. The general reader found 116 of 118 lines, glued words, pulled the rewards panel and footer into descriptions and could not reconcile.
- A Citi-only reader (readCitiCard) runs before the general reader and returns null for any other statement. On the client statement: 118 of 118 lines, both totals match. Fixture is made up (tests/fixtures/statements/citi-card-sample.pdf).

## 1.65.1 checkpoint (2026-11-27) — lists fill the page width
- Cause: `UI.enhanceTables` (js/ui-tables.js) gave every keyed table `width: <sum of columns>px`, so lists with few columns (Vendors with no company/email/phone: Name + Open balance) ended mid-page inside a full-width box.
- Fix: tables with keys `list:*` (customers, vendors, accounts, transactions, register) get `width: max(100%, <sum>px)`; the widest text column the person has not resized gets no fixed width and takes the spare room (amount columns, the ✓ column and the actions column never do). If every text column was resized, the spare room is spread over all columns. `report:*` tables are unchanged.
- Sweep: Playwright, 54 routes at 1700×950 with sample data, tables narrower than 80% of their page. Before: vendors (and customers/accounts/transactions with bare contacts). After: only builder (report layout, intended), snapshot (dashboard cards), reclassify and close (tables inside side panels that are full) — not changed.
- Tests: `node app/tests/run-node.js` 276/276; `build-site.py --check` OK. Browser checks: vendors/customers/accounts/transactions/register fill the box at 1700 px; resizing Name keeps 266 px and the table still fills; double-click reset restores; at 900 px transactions scrolls sideways (884 px table in 863 px box); GL report width unchanged; no page errors.
- Next action: none required; look at the phone layout of the lists on a real iPhone (mobile.css sets its own table widths, not affected in Chromium checks).
## Session 7 checkpoint (2026-11-05) — ER-design audit, sales tax, estimates/POs, audit chain (app 1.13.0)
- Done: `docs/ERD_AUDIT.md`; sales tax (rates, lines, posting, print, .iif, Sales Tax Liability, exempt customers); estimates and purchase orders; SHA-256 hash-chained audit; closing-date history and password; credit-limit warning; SCHEMA.txt updated.
- Files:
  - Engine: `js/schema.js` (types, v5 migration), `js/ledger.js`, `js/util.js` (U.sha256), `js/reports.js`, `js/qbexport.js`, `js/invoice-layout.js`, `js/backup.js`, `js/db.js`.
  - Screens: `js/ui-forms.js`, `js/ui-settings.js`, `js/ui-pages.js`, `js/ui-reports.js`, `js/ui-core.js`, `js/ui-gateway.js`, `js/ui-palette.js`, `css/app.css`.
  - Tests: `tests/engine.tests.js`, `tests/dev/salestax_ui.py`, `tests/dev/qbinvoice_ui.py` (timing fix).
- Verification: Node 63/63; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22; salestax_ui 30/30. axe NOT RUN.
- Risks: see DEC-017.

## Session 6 checkpoint (2026-11-04) — Invoices (app 1.12.0)
- Done: classic invoice print/PDF layout matched to the user's sample; optional company logo; .iif export of selected invoices; invoice entry screen laid out like QuickBooks Desktop Create Invoices; customer message per invoice and a company message list.
- Files: `app/js/invoice-layout.js`, `app/js/qbexport.js` (new); `ui-forms.js`, `ui-pages.js`, `ui-settings.js`, `ui-palette.js`, `ledger.js`, `pdf.js`, `css/app.css`, `index.html`, tests (`tests/dev/invoice_ui.py`, `tests/dev/qbinvoice_ui.py`).
- Verification: Node 57/57; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22. axe NOT RUN (npm unreachable).
- Risks: .iif not imported into real QuickBooks; PDF fonts not embedded.

## Session 5 checkpoint (2026-11-04) — Export financial workbook (app 1.11.0)
- Request: one interconnected, editable, formula-driven Excel workbook per company (Dashboard, P&L, BS, Cash Flow, TB, GL, Income/Expense Details, AR/AP Aging, Journal Entries, Account Index), drill-down links, date filters that recalculate, tables/filters/grouping/charts, optional protection, no sync back. Decision DEC-015.
- Files added: `app/js/workbook.js`, `app/tests/dev/workbook_ui.py`, `app/tests/dev/workbook_check.py`, `app/tests/dev/lo_recalc.py`.
- Files changed: `xlsx.js` (hyperlinks, defined names, tables, autofilter, data validation, conditional formats/dxfs, outline rows, hidden columns, tab colours, charts/drawings, sheet protection, core properties, DEFLATE via `X.buildAsync`, `X.serial`; existing callers unchanged), `ui-reports.js` (Export financial workbook button + dialog), `ui-palette.js`, `index.html`, `css/reports.css`, `schema.js` (APP_VERSION 1.11.0), tests (`engine.tests.js` +2, `run-node.js`, `tests.html`), docs.
- Correction to session 4: plain `soffice --convert-to` does NOT recalculate .xlsx formulas (it keeps cached values; proven by tampering a cached value). The session 4 "LibreOffice recalculated 182 formulas" result was therefore not evidence when recorded. Re-run today with real recalculation (`lo_recalc.py`, UNO `calculateAll`): statement export 82 formulas and designer export 100 formulas → 0 differences; the tampered file is caught. Session 4 conclusions stand, now with valid evidence.
- Tests (repo root, exact results):
  - `node app/tests/run-node.js` → 54 passed, 0 failed.
  - `python3 app/tests/dev/workbook_check.py "$PWD/app"` → 48 passed, 0 failed (3 companies: calendar/July fiscal year, accrual/cash; every formula recalculates to its exported value; 6 changed date ranges equal the engine; all hyperlinks valid; 28 parts well-formed XML; bundled SheetJS reads the file; user-added sheet survives save + reopen).
  - `python3 app/tests/dev/workbook_ui.py "$PWD/app/index.html"` → 18 passed, 0 failed.
  - designer_ui 40/40; vaultbook_ui 40/40; migrate_ui 38/38; e2e 191/191.
  - Performance (ad hoc): 20,000 transactions / 50,000 lines → 3.9 s, 7.3 MB; LibreOffice opens and recalculates it in 23 s with the same net income.
- Known limitations: not opened in Microsoft Excel here; journal and ledger lines cover the exported period (balances use all earlier data, and the Dashboard warns when dates go outside it); aging is the open-item snapshot on the export date; statement/designer exports (1.10) still write uncompressed files.

## Session 4 checkpoint (2026-11-04) — Financial reporting & statement designer (app 1.10.0)
- Request: enterprise financial reporting (Statement Writer–class designer, PDF and Excel engines, MTD/QTD, reconciliation) without breaking existing features, storage or offline use. Audit, gaps, library research and phases: `docs/REPORTING_PLAN.md`; decisions DEC-013, DEC-014.
- Git: repository had no `.git` in the received zip; session created a baseline commit of the zip as received, then the session commit.
- Files added: `app/js/pdf.js` (PDF writer), `app/js/report-model.js` (shared model + Excel/PDF adapters), `app/js/designer.js` (template engine), `app/js/ui-designer.js` (`#/designer`), `app/tests/dev/designer_ui.py`, `docs/REPORTING_PLAN.md`.
- Files changed: `statements.js` (MTD/QTD, `R.fiscalQuarterStart`, `R.reconcile`, `valueCols`/`cellsFor` on results), `xlsx.js` (style registry, formulas, merges, frozen panes, print titles, page setup; existing calls unchanged), `ui-core.js` (`UI.pdfSetup`, `UI.exportMatrix` report/model options and PDF), `ui-statements.js` (shared formatter, model export, Export to PDF + Print, row styles/formats/conditional classes, `UI.statementTable`, `UI.statementModel`), `ui-reports.js` (PDF button, `recon` report, designer entry, My reports links), `ui-builder.js` (PDF), `ui-palette.js`, `ui-keys.js`, `index.html`, `css/reports.css`, `schema.js` (APP_VERSION 1.10.0), tests (`engine.tests.js` +7 tests, `run-node.js`, `tests.html`, `e2e_playwright.py` Excel check reads values with data_only and also checks formulas/frozen panes), docs.
- Not changed: `ledger.js`, `reports.js`, `db.js`, `backup.js`, `crypto.js`, migrations, IndexedDB names/versions, data format (4), backup format.
- Tests (repo root, exact results):
  - `node app/tests/run-node.js` → 52 passed, 0 failed (was 45).
  - `python3 app/tests/dev/designer_ui.py "$PWD/app/index.html"` → 40 passed, 0 failed (new).
  - `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"` → 191 passed, 0 failed (190 + new Excel formulas/freeze check).
  - `python3 app/tests/dev/vaultbook_ui.py "$PWD/app/index.html"` → 40 passed, 0 failed.
  - `python3 app/tests/dev/migrate_ui.py "$PWD/app/index.html"` → 38 passed, 0 failed.
  - `app/tests/tests.html` in Chromium → 52 passed, 5 failed; the 5 are the QuickBooks import tests that fetch fixtures, which fail identically on the untouched 1.9.0 baseline (45 passed, 5 failed) because file:// pages cannot fetch files. All 7 new tests pass in the browser.
  - Independent checks (ad hoc): [corrected in session 5 — the LibreOffice step used here did not recalculate; re-verified with real recalculation in session 5: 82 + 100 formulas, 0 differ] `qpdf --check` and `pypdf` (strict) open every generated PDF; openpyxl reads freeze panes, merges, print titles, orientation.
  - axe audit: NOT RUN — axe-core could not be downloaded (npm/CDN blocked by sandbox policy). designer_ui.py checks accessible names and unique ids instead.
- Known limitations / risks: PDF uses standard Helvetica (characters outside Windows-1252 print as "?"; no logos/images); Excel files not opened in real Microsoft Excel (LibreOffice + openpyxl only); template formulas in Excel are written only in value columns ($/% change columns keep values); designs saved in 1.10 are listed but cannot be opened by 1.9; column drag-and-drop and cross-column formulas not built (FR-007).

## Session 3 checkpoint (2026-11-04) — QuickBooks migration, items, QuickBooks-standard reports
- Request: a converter inside each company that takes every file QuickBooks Desktop exports and brings all financial data into VaultBook; add missing features; make Open Invoices (and the other default QuickBooks reports) available under Reports.
- Files added: `app/js/qbimport.js` (pure engine), `app/js/ui-migrate.js` (`#/migrate`), `app/js/ui-items.js` (`#/items`), `app/tests/fixtures/qb/*` (synthetic, no client data), `app/tests/dev/migrate_ui.py`.
- Files changed: `schema.js` (DATA_VERSION 4, ITEM_TYPES, CONTACT_EXTRA, APP_VERSION 1.9.0), `db.js` (company DB v4, `items` store), `ledger.js` (items, `saveItem`, `importBundle`, line `itemId`, extended contact fields), `reports.js` (openDocs, contactDetail, salesByCustomer, salesByItem, bankDetail), `ui-reports.js` (11 report entries + renderers), `ui-forms.js` (Product/service line column), `ui-pages.js` (new-company QuickBooks option, contact "More details"), `ui-gateway.js`, `ui-keys.js`, `ui-palette.js`, `ui-settings.js`, `ui-statement.js`, `index.html`, `vault.css`, tests.
- Decisions: DEC-011 (data format 4), DEC-012 (migration policy).
- Tests (repo root, exact results):
  - `node app/tests/run-node.js` → 45 passed, 0 failed.
  - `python3 app/tests/dev/migrate_ui.py "$PWD/app/index.html"` → 38 passed, 0 failed.
  - `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"` → 190 passed, 0 failed.
  - `python3 app/tests/dev/vaultbook_ui.py "$PWD/app/index.html"` → 40 passed, 0 failed.
  - `AXE_JS=…/axe-core@4.10.2/axe.min.js python3 app/tests/dev/a11y_audit.py "$PWD/app/index.html"` → TOTAL issue types: 0 (now includes #/migrate, #/items, openinv, custlist).
  - Upgrade check (ad hoc Playwright, same profile): company created by 1.8.0 (data v3) opened in 1.9.0 → 54/54 transactions, A/R unchanged, dataVersion 4, integrity 0 issues; item saved and persisted after reload.
  - Real client export (10 files, kept out of the repo; dev script outside repo): 470 transactions posted; 66/66 account balances equal QuickBooks; trial balance 40,606,756.13 = 40,606,756.13; total assets 4,041,690.57 = BS PDF; P&L PDF 10 lines and BS PDF 6 lines match; Open Invoices 16,070,877.59 ties to A/R; Sales by Customer = total income; backup validates.
- Known limitations: inventory quantities on hand not tracked; QuickBooks discount terms keep only the net days (warning); non-posting accounts (Sales Orders/Estimates) skipped; duplicate QuickBooks document numbers renamed with suffixes; 3 payments in the real file applied oldest-first (no reference); Sales by Product/Service includes item lines posted to non-income accounts (e.g. a retainer liability account), as QuickBooks does.

## Session 2 checkpoint (2026-10-22) — Tally-inspired redesign
- Research: 35 TallyHelp references (34 images viewed in Chrome + shortcut page) → `docs/UI_RESEARCH.md`; images in `reference-ui/research/` (git-ignored, © Tally Solutions, research only).
- Files added: `app/js/ui-keys.js`, `app/js/ui-gateway.js`, `app/js/ui-config.js`, `app/js/ui-entry.js`, `app/css/vault.css`, `app/tests/dev/vaultbook_ui.py`, `reference-ui/before|after/*.png`.
- Files changed: `app/index.html` (brand, command bar, work area + panel, scripts), `app/js/ui-core.js` (default route gateway, modal `cls`), `ui-windows.js` (Gateway home window, `#/` normalisation, tabs landmark, tooltips), `ui-palette.js`, `ui-shortcuts.js` (registry in F1/? panel, G H), visible strings in `backup.js`, `db.js`, `schema.js` (+ APP_VERSION 1.8.0), `ui-pages.js`, `ui-reports.js`, `ui-security.js`, `ui-settings.js`; tests `e2e_playwright.py` (home = `.gateway, .dash`), `a11y_audit.py` (Gateway pages added).
- No change to `ledger.js`, `reports.js`, `statements.js`, `db.js` schema, `crypto.js`, migrations or stored data shape. Backup format id and all storage identifiers unchanged (DEC-006).
- Tests (exact commands, repo root):
  - `node app/tests/run-node.js` → 39 passed, 0 failed.
  - `python3 app/tests/dev/vaultbook_ui.py "$PWD/app/index.html"` → 40 passed, 0 failed.
  - `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"` → 190 passed, 0 failed (last two runs; BUG-001 flaky check passed in both).
  - `AXE_JS=<axe-core 4.10.2>/axe.min.js python3 app/tests/dev/a11y_audit.py "$PWD/app/index.html"` → TOTAL issue types: 0 (baseline was 8).
- Visual verification: 43 screenshots reviewed (`reference-ui/after/`), light/dark/phone. **Limitation:** Claude in Chrome refused `file://` URLs, so the app could not be opened in the user's Chrome; inspection used Playwright Chromium in the cloud.
- Risks: F-key and Alt behaviour on real Windows/macOS browsers unverified (DEC-010); Alt+F5 is context-dependent (report detail vs vendor credit); sidebar and Gateway both present (intentional, for mouse users).

## Session 1 checkpoint (2026-10-22)
- Task IDs: AUD-001…005, FOUND-001 (partial), FOUND-004, BUG-002.
- Files changed: `app/js/ui-windows.js` (BUG-002 fix), `app/tests/dev/e2e_playwright.py` (harness updated for 1.7.0 UI + 4 regression checks), `AGENTS.md` and `docs/PRODUCT_SPEC.md` (name note only), `docs/*` (plan, state, resume, inventory, decisions, new AUDIT_BASELINE.md), `.gitignore`.
- Tests run and results:
  - `node app/tests/run-node.js` → 39 passed, 0 failed (before and after the fix).
  - e2e with fix, 3 runs → 190/190, 189/190, 189/190; the single failure each time is the pre-existing flaky BUG-001 scroll check.
  - e2e with the new checks against the original `ui-windows.js` → "Switching window tab with unsaved changes asks first" FAILS (confirms the test detects the bug).
  - axe audit (baseline, before fix) → 8 issue types; fix is logic-only, axe not re-run.
- Known regressions/risks:
  - BUG-001 flaky double-scroll on GL (pre-existing).
  - Git on the Mac: the connected folder disallows deletes until approved, so git lock files may block commits there; git was run in the cloud workspace and the repo (with `.git`) copied to the folder.
  - Not tested on real Windows or macOS hardware; Chromium on Linux only.
- Blockers: none.

## Risks to inspect (open)
- F-key reservations on macOS (media keys) and browsers (F5/F11/F12) before FOUND-005.
- Alt+N on macOS likely produces a dead key (unverified).
- Window manager does not keep forms alive; navigation stack (FOUND-003) must define how windows and Back interact.

## Exact next action
1. Open a financial workbook in Microsoft Excel (Windows and macOS): change the Dashboard dates, click drill-down links, check tables, grouping, chart and print preview (XW-007); also a statement and a designer export (FR-003/004).
2. Print a multi-page General Ledger PDF on a physical printer (Letter and A4).
3. Run the axe audit with axe-core 4.10.2 where npm is reachable; add `#/designer` and the export dialogs.
4. Consider compressing statement/designer Excel exports with `X.buildAsync`.
5. FR-007 scope; earlier queue: QA-002, CONTACT-001, MIG-005, ENTRY-002, AUD-004.
