# VaultBook — Handoff for a new Claude session

> **To the next Claude:** read this whole file first, then `AGENTS.md`, `docs/RESUME.md` and `docs/PROJECT_STATE.md`.
> This file is the history of the earlier work, written when the project moved accounts. The source code and tests are the ground truth. If this file disagrees with them, the code wins.
> Handoff date: 2026-11-10. App version **1.65.0**, data format **8** (IndexedDB company schema 6).

---

## 0. How to start (for the user)

1. Upload `VaultBook-1.51.0.zip` to the new Claude chat or project (this file is inside it, at `VaultBook-1.51.0/HANDOFF.md`).
2. Paste this first message:

```
This is my VaultBook project, moved from another Claude account. Unzip VaultBook-1.51.0.zip,
read HANDOFF.md, AGENTS.md, docs/RESUME.md and docs/PROJECT_STATE.md, run
`node app/tests/run-node.js` to confirm the baseline (79 passed), then tell me in a few lines
what state the project is in. Then continue with: <your next request>.
```

3. Optional: install the "ponytail" skills again in the new account (section 6).

---

## 1. What VaultBook is

- An **offline, browser-only, double-entry accounting app for US small businesses**. It was formerly named "OfflineBooks US", and was renamed VaultBook in decision DEC-006.
- It runs by opening `app/index.html` in Chrome or Edge (file://). There is no server, build step, install, internet or CDN.
- The user is building it as "our project". The aim is a polished, keyboard-first app inspired by **Tally Prime** interaction principles, with **QuickBooks Desktop-compatible** features: QuickBooks import (existed before), .iif export, invoice screens like QuickBooks, and QuickBooks-standard reports.
- Data lives in **IndexedDB** in the browser, with optional encryption, backup/restore files and multiple companies.

---

## 2. Rules the user and the project set

These are in `AGENTS.md` (read it in full). The most important ones:

- **Preserve everything:** features, UI/UX, keyboard shortcuts, the database and backup compatibility. Never silently remove or stub a feature.
- **Never rename storage identifiers:**
  - registry DB `OfflineBooksUS`
  - company DBs `OfflineBooksUS_<id>`
  - prefs key `OfflineBooksUS.prefs.v1`
  - backup format `OfflineBooksUS-Backup`
  - The visible name is VaultBook.
- **Stay offline:** no cloud, no CDN, no new runtime dependencies. Own writers exist for PDF and XLSX.
- **No dead or decorative controls.** Every visible button must work. (This is why the QuickBooks-style invoice screen has no Email, Attach, Memorize, Template or Mark As Pending buttons.)
- **No copying of proprietary branding or assets** (Tally or Intuit logos and icons). Icons are drawn new.
- **No fabricated test results.** A task is PASS only with evidence; otherwise it is NEEDS VERIFICATION.
- **Docs after every piece of work:**
  - `docs/PROJECT_STATE.md`
  - `docs/RESUME.md` (append a session entry)
  - `docs/DECISIONS.md` (a DEC-0NN entry for real decisions)
  - `docs/IMPLEMENTATION_PLAN.md` (task table with statuses)
  - `app/CHANGELOG.txt`
  - `app/USER_GUIDE.txt`
  - Bump `S.APP_VERSION` in `app/js/schema.js`.
- **Line endings:** keep **CRLF** in `app/USER_GUIDE.txt`, `app/README.txt` and `app/docs/SCHEMA.txt`. `CHANGELOG.txt` is LF.
- Statuses allowed: `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `PASS`, `FAIL`, `NEEDS VERIFICATION`.
- Commits end with Co-Authored-By / Claude-Session attribution lines (the new account's own lines).

**User preferences seen in this work:**
- Writes short, often uppercase requests. Wants "exact clones" of QuickBooks screens and formats when it says so.
- Wants a **downloadable zip** of the whole project after each version (`VaultBook-<version>.zip`, top folder `VaultBook-<version>/`), plus screenshots.
- Last decision on invoices:
  - The **entry screen** follows the QuickBooks layout but must use **VaultBook's own theme** (colours, fonts, controls, light/dark).
  - Only the **outgoing print/PDF invoice** keeps the exact sample/QuickBooks format.
- The sample invoice's logo (RADIOLOGY ONE) must **not** be a default in VaultBook. It was extracted and given to the user separately as `logo_1600.png`, `logo_1600_transparent.png` and `logo_full.png`; it is not in the zip. Users can add their own logo in Settings.

---

## 3. History of the work (in order)

| Version | Request (user's words, shortened) | What was built |
|---|---|---|
| 1.9.0 | Received as the starting point (git `baseline`) | Existing app: ledger, invoices/bills/payments, banking and reconciliation, budgets, 1099, classes, items, QuickBooks Desktop import, Gateway / F-key navigation, Tally-style UI layer (`css/vault.css`) |
| — | "Install this skill… https://github.com/DietrichGebert/ponytail.git", plus "ponytail-debt" | Installed ponytail, ponytail-review, ponytail-audit and ponytail-debt as account skills |
| 1.10.0 | Enterprise financial reporting upgrade (core engine, visual designer, financial reports, PDF/Excel engines; keep UI, shortcuts, DB and backups; offline; no CDN) | Statement designer (`designer.js`, `ui-designer.js`, JSON templates, formula rows, highlights); shared report model (`report-model.js`); own **PDF writer** (`pdf.js`); styled Excel exports with live formulas (`xlsx.js`); P&L MTD/QTD columns; report reconciliation. DEC-013, DEC-014 |
| 1.11.0 | "Build VaultBook Interactive Financial Excel Workbook" (12+ sheets, drill-down, date filters, editable, SUMIFS, tables, optional protection, per company, no sync, row limits, Excel/LibreOffice compatible) | `workbook.js`: one data sheet plus 14 formula-driven sheets, From/To date cells that recalculate every report, hyperlink drill-down, tables, chart, outline groups, DEFLATE compression. Reports › Export financial workbook. DEC-015 |
| 1.12.0 | (a) "Same format for invoice structure as the sample PDF… don't add the logo by default… extract the logo and give it to me… give an option to add a logo". (b) "Exact clone of this invoice format, same font and design… select multiple invoices and export to .iif to import directly into QuickBooks". (c) Screenshot of QuickBooks Create Invoices: "replicate the exact clone in our project" | (a, b) `invoice-layout.js`: one drawing used for both the SVG screen preview and the PDF, measured against the sample. Times New Roman 12 pt company block, Arial Bold 21.12 pt "Invoice", Date/Invoice # box, Bill To box, Description/Amount table, footer message and Total. Verified with pdfplumber: 40/40 box lines and text starts within 0.00 pt. Optional logo in Settings › Company (PNG data URL ≤ 1200 px). `qbexport.js`: IIF writer (`!ACCNT/!CUST/!INVITEM/!TRNS/!SPL/!ENDTRNS`, CRLF, Windows-1252); Transactions › QuickBooks .iif dialog (dates, customer, open only, tick list, include lists, to-be-printed); a button on a single invoice; also in Ctrl+K. (c) Invoice entry screen in the QuickBooks Create Invoices layout (`qbInvoiceForm` in `ui-forms.js`). DEC-016 |
| 1.65.0 | Citi card statements: every line, card signs, spaced names, cardholder sections, Account summary totals | js/vendor/statement-engine.js (readCitiCard); tests/dev/citicard_ui.py, tests/dev/make_citi_fixture.py, tests/fixtures/statements/citi-card-sample.pdf |
| 1.64.0 | .iif from any report: tick boxes, select all, progress indicator, import question | js/qbexport.js (anyIIF), js/ui-reports.js (bindIIF), css/studio.css; tests/qbsend.tests.js QS-15, tests/dev/reportiif_ui.py. |
| 1.63.0 | Connector 8 Remove what VaultBook sent (dates, [VB:] only, typed DELETE); empty check numbers stay empty | tools/VaultBook-QB.ps1 (DoRemove, refNo), js/qbsend.js (Deleted in applyResult), js/qbexport.js (mark), js/ui-qbd.js; tests/qbsend.tests.js QS-14. |
| 1.62.0 | Bank transactions of a period as one .iif; imported mark; Bank feed export skips what QuickBooks has | js/qbsend.js (inQB, markIIF), js/qbexport.js (txnsIIF, pick, clean), js/ui-qbsend.js; tests/qbsend.tests.js QS-13, tests/dev/qbfrom_ui.py 19. |
| 1.61.0 | Long sends to QuickBooks in parts of 25 through the link, progress, resume after a QuickBooks stop | js/qbsend.js (chunks, resultSummary), js/ui-qbsend.js (runSend), tools/VaultBook-QB.ps1 (yes for later parts, version 1.61, pause); tests/qbsend.tests.js QS-12, tests/dev/qbfrom_ui.py 15. |
| 1.60.1 | Fix: text for QuickBooks in its own character set (a long dash stopped a whole send) | js/util.js (U.qbText), js/qbsend.js, js/qbupdate.js, tools/VaultBook-QB.ps1 (X); tests/qbsend.tests.js QS-11. |
| 1.60.0 | Connector menu reordered and renamed (7 lines) | tools/VaultBook-QB.ps1 (menu, switch, start box, header), tools/VaultBook QuickBooks.cmd (comment), js/ui-qbd.js, js/ui-qbupdate.js, js/ui-qbsend.js, js/ui-migrate.js, USER_GUIDE, README. Not run on Windows. |
| 1.59.0 | Send by period (one day, 12 months, custom) and straight to the tool through the link | js/qbsend.js (fromDate to), js/ui-qbsend.js (By date tab, Send to QuickBooks now), js/ui-menubar.js; tests/qbsend.tests.js QS-10, tests/dev/qbfrom_ui.py 12. |
| 1.58.0 | Send to QuickBooks from a date; imported-from-QuickBooks entries count as already there | js/qbsend.js (Q.fromDate, sendList), js/ui-qbsend.js (From a date tab), js/ui-menubar.js, css/studio.css; tests/qbsend.tests.js QS-10, tests/dev/qbfrom_ui.py. |
| 1.57.0 | Bank feed uses the books' history: sure / to check / none, sort and show, bulk select | js/hints.js (payeeText, vendorMatch), js/close.js (habits by contact, forFeed), js/bankfeed.js and js/bankplus.js (memo, date windows, far matches), js/ui-bankfeed.js, js/merchants.js, css/studio.css; tests/close.tests.js CL-08..11, tests/dev/feedengine_ui.py. |
| 1.51.0 | Menu bar, icon toolbar, grey and blue colours | js/ui-menubar.js (new), css/studio.css, index.html, js/prefs.js, js/ui-core.js, js/ui-keys.js, js/ui-studio.js, tests/dev/menubar_ui.py; side-menu tests seed the side menu on. |
| 1.50.4 | No how-to notes on screens | js/ui-core.js (UI.page), js/ui-forms.js, js/ui-pages.js, js/ui-builder.js, js/ui-designer.js, js/ui-reports.js, js/ui-snapshot.js, js/ui-studio.js, js/ui-planning.js, js/ui-paste.js, js/ui-calendar.js, js/ui-docs.js, js/ui-close.js. |
| 1.50.3 | Reports follow a typed date by themselves | js/util.js, tests/dev/dates_ui.py. |
| 1.50.2 | Typed report dates; duplicates removed | js/util.js, js/ui-statements.js, js/ui-reclass.js, js/ui-tally.js, js/ui-designer.js, js/taxreports.js, js/ui-statement.js, js/ui-bankfeed.js, js/ui-reports.js, js/ui-pages.js, index.html, tests/dev/dates_ui.py, tests/dev/sheets_ui.py, tests/calendar.tests.js. |
| 1.50.1 | Calendar: click, drag, multi-select, hour grid, undo | js/calendar.js, js/ui-calendar.js, js/ui-keys.js ([data-overlay]), css/vault.css, tests/calendar.tests.js, tests/dev/calendar_ui.py. |
| 1.50.0 | Calendar | js/calendar.js, js/ui-calendar.js, js/ledger.js (company.calendar), index.html, css/vault.css, tests/calendar.tests.js, tests/dev/calendar_ui.py. |
| 1.49.0 | Doc Center | js/doccenter.js, js/ui-docs.js, js/ui-close.js, js/ui-migrate.js (pdfText shared), js/ui-business.js, index.html, css/vault.css, tests/docs.tests.js, tests/dev/docs_ui.py. |
| 1.48.1 | Paste entries: split one amount from Excel | js/paste.js, js/ui-paste.js, tests/paste.tests.js, tests/dev/paste_ui.py. |
| 1.48.0 | Paste entries from Excel into a ledger | js/paste.js, js/ui-paste.js, js/qbimport.js (toDraft shared), js/ui-pages.js, index.html, css/vault.css, tests/paste.tests.js, tests/dev/paste_ui.py. |
| 1.47.1 | Excel and CSV bank files: type column, header row, sheet choice | js/importer.js, js/ui-bankfeed.js, js/ui-statement.js, tests/sheets.tests.js, tests/dev/sheets_ui.py. |
| 1.47.0 | Update QuickBooks to match VaultBook; connector link 7/8 | js/qbupdate.js, js/ui-qbupdate.js, js/ui-qbd.js, index.html, tools/VaultBook-QB.ps1, tests/qbupdate.tests.js, tests/dev/qbupdate_ui.py. |
| 1.46.0 | Close the books (prepare, review, questions, reconcile, flux, adjusting, sign-off) | js/close.js, js/ui-close.js, js/bankfeed.js, js/ledger.js, tests/close.tests.js, tests/dev/close_ui.py. |
| 1.45.2 | Extra help checked across all company kinds | js/hints.js, js/merchants.js, tests/hints.tests.js, tests/dev/hints_ui.py. |
| 1.45.1 | Common merchants list to 1,487 | js/merchants.js, js/hints.js, tests/hints.tests.js. |
| 1.45.0 | Bank feed extra help (other clients / common merchants) | js/hints.js, js/ui-bankfeed.js, tests/hints.tests.js, tests/dev/hints_ui.py. |
| 1.44.0 | General Ledger from PDF | js/qbimport.js, js/ui-migrate.js, tests/engine.tests.js. |
| 1.43.0 | QuickBooks Desktop import: closed-year ledgers | js/qbimport.js, js/ui-migrate.js, tests/engine.tests.js. |
| 1.42.1 | Intelligence panel polish | css/studio.css. |
| 1.42.0 | VaultBook Intelligence | js/intel.js, js/ui-intel.js, index.html, css/studio.css, tests/intel.tests.js, tests/dev/intel_ui.py, docs/DECISIONS.md (DEC-041). |
| 1.41.1 | QBO account type from General Ledger order | js/qbimport.js, tests/qbo.tests.js. |
| 1.41.0 | Ctrl+P prints the real report; QBO zero-balance accounts | js/ui-core.js, js/ui-keys.js, js/ui-palette.js, js/qbimport.js, tests. |
| 1.40.1 | Layout setting always takes effect | js/ui-statements.js, tests/dev/txdetail_ui.py. |
| 1.40.0 | Twelve statement layouts (setting, report, print, PDF) | js/report-model.js, js/ui-statements.js, js/ledger.js, js/ui-settings.js, js/ui-config.js, css/reports.css, tests. |
| 1.39.0 | Statement looks | js/ui-statements.js, css/reports.css, tests/dev/txdetail_ui.py. |
| 1.38.2 | Import fix: early due dates | js/qbimport.js, tests/qbfull.tests.js. |
| 1.38.1 | Import fix: "- Other" ledger accounts | js/qbimport.js, tests/engine.tests.js. |
| 1.38.0 | Send bank transactions to QuickBooks | js/qbsend.js, js/qbsync.js, js/ui-qbsend.js, js/ui-qbd.js, tools/VaultBook-QB.ps1, tests/qbsend.tests.js, tests/qbsync.tests.js, tests/dev/qbsend_ui.py. |
| 1.37.1 | Date box typing fix | js/util.js (dateCommit), js/ui-bankfeed.js, js/ui-pages.js, js/ui-business.js, js/ui-payroll.js, js/ui-migrate.js, tools/paystub-iif. |
| 1.37.0 | Connector: reports and ledgers, deposit guard, gentler sending | tools/VaultBook-QB.ps1, tools/VaultBook QuickBooks.cmd, js/qbsync.js, js/ui-qbd.js, tests/qbsync.tests.js. |
| 1.36.0 | Dense ledger look (design review fixes) | css/studio.css, css/theme.css, js/ui-forms.js, js/ui-core.js, js/ui-pages.js, js/ui-studio.js, js/ui-reports.js, js/ui-statements.js, js/ui-windows.js, js/reports.js (home opts). |
| 1.35.0 | Payroll: post to the books + .iif | js/ui-payroll.js, js/paystub.js (posted for combined), css/studio.css. |
| 1.34.1 | Combined payroll entry in the IIF tool | js/paystub.js (mergeDrafts), tools/paystub-iif. |
| 1.34.0 | Payroll documents and cross-check | js/paydocs.js, js/ui-payroll.js, tools/paystub-iif, js/vendor/statement-engine.js (form fields), tests/paydocs.tests.js, tests/dev/make_paydocs_fixtures.py. |
| 1.33.1 | Paystub to QuickBooks IIF tool | tools/paystub-iif/ (src + build.py), js/paystub.js (toIIF), tests/dev/paystub_iif_ui.py. |
| 1.33.0 | Payroll from paystubs | js/paystub.js, js/ui-payroll.js, js/vendor/statement-engine.js (ocrImageRows), tests/paystub.tests.js, tests/dev/payroll_ui.py, tests/dev/make_paystub_fixture.py, tests/fixtures/paystub/. |
| 1.32.0 | QuickBooks Desktop section, import everything | js/qbfull.js, js/ui-qbd.js, js/qbimport.js (qbfull kind, exact links), js/ui-migrate.js, js/ui-qbsend.js, tools/VaultBook-QB.ps1 (option 5, console UI). |
| 1.31.0 | Read QuickBooks, month gap | js/qbsync.js, js/ui-qbsend.js (Months tab), tools/VaultBook-QB.ps1, tools/VaultBook QuickBooks.cmd. |
| 1.30.0 | Send to QuickBooks Desktop | js/qbsend.js, js/ui-qbsend.js, tools/VaultBook-QB-Send.ps1, tools/Send to QuickBooks.cmd, tools/Check only (nothing written).cmd. |
| 1.29.2 | Income accounts per invoice | js/paydays.js (incomeFields, allFields), js/ui-reports.js (Fields dialog, list cells), css/studio.css. |
| 1.29.1 | Payment Days drill-down | js/paydays.js (drill), js/report-model.js (depth → Excel row groups), js/xlsx.js (summaryAbove), js/ui-reports.js, css/studio.css. |
| 1.29.0 | Invoice Payment Days (MIS) | js/paydays.js (engine), js/ui-reports.js (REPORTS.paydays, RENDER.paydays, toolbar/bind hooks), css/studio.css (pd-*). |
| 1.28.0 | QuickBooks Desktop connector | js/qbexport.js (connectorBatch), js/ui-bankfeed.js (button), tools/VaultBook-QB-Connector.ps1 and .cmd launchers. |
| 1.27.3 | Payments to QuickBooks Desktop | js/qbexport.js (PAYMENT/BILLPMT, appliedText, paymentList), js/ui-bankfeed.js (export panel). |
| 1.27.2 | Reconciliation report | js/recon-report.js (model), js/report-model.js (portrait, label overflow, notes), js/ui-banking.js (screen and exports). |
| 1.27.1 | Bank feed fix | js/ui-bankfeed.js (Posted/Excluded row click). |
| 1.27.0 | Find: search all company data | js/find.js (engine), js/ui-find.js (screen), js/ui-palette.js (Search all row), js/ui-nav.js (gear entry). |
| 1.26.2 | One invoice, several deposits | js/bankplus.js (split candidates, invoice-number evidence, oldest-first ties), js/ui-bankfeed.js (split label, amounts in the post). |
| 1.26.1 | One deposit, several invoices | js/bankplus.js (multi-invoice candidates, bankOpenDocs), js/bankfeed.js (part payments in 'open'), js/ui-bankfeed.js (manual picker). |
| 1.26.0 | QuickBooks Online patterns | js/ui-nav.js (bookmarks, gear, compact menu), js/ui-keys.js (Ctrl+Alt keys, Ctrl+D), js/bankfeed.js (updateBankLine), js/statements.js (statementChart), js/ui-statements.js (modern bar, chart, Classic layout), js/ui-studio.js (home Customize, Privacy), js/ui-pages.js (contact hub tabs), js/ui-forms.js (form preview). |
| 1.25.1 | Register graphs; folding filters; shorter Gateway | js/ui-tally.js (monthChart, vregSide panel), js/ui-gateway.js (Company sub-menu), js/ui-studio.js, css/studio.css. |
| 1.25.0 | Studio look; home widgets; + New menu | css/studio.css (whole-app restyle); js/ui-studio.js (top bar, home tabs, Business overview, + New menu, Banking badge); reports.js R.home; tests/studio.tests.js, tests/dev/studio_ui.py. |
| 1.24.0 | QuickBooks Online Excel import; company from files | js/qbimport.js (Q.sheetRows, qbo* readers, QBOBAL expected balances); ui-migrate.js (Excel reader, UI.companyFromQuickBooks); ui-pages.js + ui-tally.js (Create from QuickBooks files, Alt+Q); tests/qbo.tests.js, tests/dev/qbo_ui.py. |
| 1.23.0 | All three bank items + already-in-books on import | js/bankplus.js (rules v2, deposit/group matches, bankBooksPairs/_matchToBooks, import options); ledger.js reconciliation adjustment + frozen report; ui-banking.js rule editor, reconcile find/adjust, #/recreport; ui-bankfeed.js preview/candidates. |
| 1.22.0 | Tally-style keys, registers, one P&L, Reclassify | util.js smartDate; registers.js; reclass.js; ui-tally.js (#/vreg, F2/Alt+F2, Alt+N/Alt+C/Ctrl+B panel, company keys); ui-reclass.js (#/reclassify); ui-gateway.js header; ui-keys.js cursor. |
| 1.21.0 | Bank feed → QuickBooks | qbexport.js bankIIF/bankCSV/pickBankLines (posted lines only); bankfeed.js recordBankExport/undoBankExport; ui-bankfeed.js More menu export panel. |
| 1.20.0 | Bank feed | js/bankfeed.js (importBankLines, bankCandidates, postBankLine, undoBankLine, exclude/restore, undoBankImport, bankSuggestion, profiles); js/ui-bankfeed.js (#/bankfeed; #/import redirects); importer.js scoring, dates, checkFile, checkBalances, ruleTextFor. |
| 1.19.0 | CPA audit fixes | Engine: ledger.js (saveTransactions, warnings, _voidAsOf, applyCredit), business.js (discounts, bounced payments), inventory.js (MACRS tables, disposal, recost), reports.js (cash flow, aging), taxreports.js (cash basis); tests/cpa.tests.js. Dashboard drill in ui-pages.js. |
| 1.18.8 | One highlight | Pointer drives the keyboard row cursor (`ui-keys.js`); no CSS row `:hover` backgrounds. |
| 1.18.7 | Transaction detail | `RENDER.txdetail(b, p)` with `p.src` pnl/bs and `p.node` (statement key or `net:<section>`); drill links from `ui-statements.js` `drill()`. |
| 1.18.6 | Flat sheets | CSS only (vault.css tail): white `#main`, flush entry forms and report pages. |
| 1.18.5 | Dialog letters | `UI.modal` actions with `key` render the letter underlined via `mnLabel()`. |
| 1.18.4 | Desktop reports | Statement wording in `statements.js` (`totalOf`, `qbDate`, `qbRange`); `ui-statements.js` Desktop toolbar (`#st-hdr`, `#st-rows`, `.sb-meta`, `falign` '' = corner); `ui-combo.js` `item` source; Esc → `setTimeout(K.back)`; modal actions take `key`. |
| 1.18.3 | Invoice ribbon | `qbRibbon()` in ui-forms.js builds groups of `.qbi-tool` (big) and `.qbi-stack > .qbi-mini` (stacked); all reuse existing `data-act` handlers. Function-key panel: `.fk-collapse` / `#fk-show` toggle pref `fkeys`. |
| 1.18.2 | Entry density | `ui-entry.js` puts the voucher strip (type-switch keys only) inside `.qbi-tools` on invoice-style forms; `.qbi.txform` has no padding; toolbar buttons are horizontal; `.window-tabs` flex-shrink 0; `col.c-bill`. |
| 1.18.1 | Design polish | Impeccable audit (docs/DESIGN_AUDIT.md): `max(11px, …)` text floor in CSS, side stripes/glow removed, flat dashboard KPIs and totals, `ui-core.js` nav active fix (query links win). No data change. |
| 1.18.0 | Batch 5 of 5 | `js/taxreports.js`: `taxPartsOf`, `taxAgencies`, `R.salesTaxByAgency`, `paySalesTax`, `R.collections`, `R.missingChecks`, `R.changedTransactions`, `R.cashForecast`; sales tax `components` / `taxParts` / line `taxAgency`; contact `exemptCert`. Feature status: `docs/US_FEATURE_AUDIT.md` |
| 1.17.0 | Batch 4 of 5 | `js/sales.js`: price levels (`savePriceLevel`, `priceFor`), deposits (`depositAccount`, `depositsHeld`, `receiveDeposit`), `batchInvoices`, `progressLines`; ledger `sourceProgress` + line `srcLine` (progress invoicing; source closes when full); `salesOrder` type. Data v8 |
| 1.16.0 | Batch 3 of 5 | `js/projects.js`: attachments (`addAttachment`, `removeAttachment`, `attachmentsFor`; store `attachments`), Customer:Job (`parentId`, `contactLabel`, `jobsOf`), billable costs (`Book.BILLABLE`, line `billable`/`billOf`, `unbilledCosts`, `billedBy`), tax lines (`Book.TAX_FORMS`, `suggestTaxLine`, `R.taxSummary`, `R.taxCsv`). Data v7, IndexedDB v5 |
| 1.15.0 | Batch 2 of 5 | Inventory (`js/inventory.js`: `tracked`, `inventoryMoves`, `inventoryState`, `_costInventory`, `_validateInventory`; `invAdjust` type; line `cost`/`cogsAccountId`/`assetAccountId`); fixed assets (`company.fixedAssets`, `Book.depSchedule`, `Book.MACRS`, `depreciationDue`, `recordDepreciation`). Reports invval, stock, fixedassets. Data format 6 |
| 1.14.0 | "Skip time tracking, users, early discounts, payroll and the low-priority list; add the rest" (batch 1 of 5) | Make Deposits (`undepositedItems`, deposit lines with `fromTxnId`, `depositedBy`); check printing (`toBePrinted`, `checksToPrint`, `setChecksPrinted`, `L.checkPages`, `U.amountWords`); 1099 W-9, `R.recipients1099/totals1096/csv1099`, `L.stmt1099Pages`; `writeOffInvoice`; `financeChargePreview/assessFinanceCharges`. Files `js/business.js`, `js/ui-business.js` |
| 1.13.0 | User's ER design ("Offline US Accounting Product", 60 tables): "except database thing… audit it and then implement required things… improve at professional level" | `docs/ERD_AUDIT.md` (area-by-area Have/Partial/Missing). Sales tax (rates on the company record in millionths; taxable lines; tax split to Sales Tax Payable; print, .iif, Sales Tax Liability report; exempt customers). Estimates and purchase orders (`nonPosting`, open/closed, convert, `sourceId`/`linkedTo`). SHA-256 hash-chained audit trail (`U.sha256`, `Book.verifyAudit`). Closing-date history and password. Credit-limit warning. Data format 5. DEC-017 |
| 1.12.1 | "Blend that inside Invoice screen as per our VaultBook UI/UX and theme; only the PDF which goes out requires the same format as QuickBooks" | Restyled `.qbi-*` CSS with VaultBook tokens only (teal bar, VaultBook type and fields, light/dark). Fixed the ITEM cell width, the repeated placeholders and a gap above the grid header. Print/PDF unchanged |

### The invoice entry screen today (`app/js/ui-forms.js`, `qbInvoiceForm`)

- **Toolbar** (all buttons work): Find ‹ › (previous/next posted invoice), Find (the invoice list), New, Save, Delete (void, kept for the audit trail), Create a Copy, Print, Receive Payments, QuickBooks .iif, and the More menu.
- **CUSTOMER:JOB bar** (customer combo). Picking a customer fills the BILL TO box and applies the customer's TERMS.
- **Header:** "Invoice" title and See History; DATE; INVOICE #; BILL TO; TERMS (Due on receipt / Net 10–90); DUE DATE.
- **Grid:** ITEM (an item select if items exist, plus an income account combo) | DESCRIPTION | QTY | RATE | AMOUNT | (CLASS) | remove. There are 14 rows to start, and rows are added as you type.
- **CUSTOMER MESSAGE:**
  - The default list matches QuickBooks.
  - `< Add New >` saves a new message to `company.customerMessages`.
  - New invoices default to "Thank you for your business."
  - Stored on the invoice as `t.message` and printed in the footer.
- **MEMO**, then TOTAL / PAYMENTS APPLIED / BALANCE DUE.
- **Bottom buttons:** Save & Close (Ctrl+S), Save & New (Ctrl+E), Revert.
- Field names are the same as the standard form, so validation, saving, the unsaved-changes guard and shortcuts are shared. Other transaction types still use the standard VaultBook form.

---

## 4. Code map (what to read for what)

`app/index.html` loads plain IIFE scripts onto the global `OB` namespace, in a fixed order.

| Area | Files |
|---|---|
| Schema, versions, transaction types | `js/schema.js` (`S.APP_VERSION`, `S.TXN_TYPES`, `S.CONTACT_EXTRA`) |
| Storage | `js/db.js` (IndexedDB), `js/backup.js`, `js/crypto.js`, `js/prefs.js` |
| Accounting engine | `js/ledger.js` (`OB.Book`: `saveTransaction`/`normalize`, `saveCompany`, `posted()`, `cmpTxn`, balances), `js/reports.js` (`R.entries`, `R.statement`, aging), `js/statements.js` |
| Money | Integer **cents** everywhere. `U.toCents`, `U.fmt`, `U.fmtPlain` in `js/util.js` |
| Reporting | `js/report-model.js`, `js/designer.js`, `js/ui-designer.js`, `js/ui-reports.js`, `js/ui-statements.js`, `js/ui-builder.js` |
| File writers | `js/pdf.js` (own PDF; fonts F1–F6: Helvetica, Helvetica-Bold, Times-Roman, TimesNewRomanPSMT, ArialMT, Arial-BoldMT, not embedded, Liberation-metric widths; JPEG images), `js/xlsx.js` (own XLSX with styles, formulas, links, tables, charts, compression), `js/workbook.js` |
| Sales tax, estimates/POs, audit chain (1.13) | `js/ledger.js` (`saveSalesTax`, `Book.parseRate/taxOn/fmtRate`, `setDocStatus`, `verifyAudit`, `Book.chainAudit`, closing password), `js/reports.js` (`R.salesTaxLiability`), `js/ui-settings.js` (Sales tax tab, closing card), `js/ui-forms.js` (`QBF` layout for invoice + estimate, `taxOn`, conversion) |
| Invoices | `js/invoice-layout.js` (print/PDF geometry), `js/ui-forms.js` (entry forms; `routes.print` preview; `qbInvoiceForm`), `js/ui-settings.js` (logo) |
| QuickBooks | `js/qbimport.js` (IIF/CSV import), `js/qbexport.js` (IIF invoice export), `js/ui-migrate.js`, `js/ui-pages.js` (`UI.exportInvoicesIif`) |
| UI shell | `js/ui-core.js` (`UI.modal`, `UI.prompt`, `UI.confirmLeave`, `UI.dirty`, theme), `js/ui-entry.js` (entry strip, current balances), `js/ui-combo.js`, `js/ui-hotkeys.js` / `js/ui-keys.js` (`data-key` = Ctrl/⌘ + letter), `js/ui-palette.js` (Ctrl+K), `js/ui-gateway.js`, `js/ui-windows.js` (tabs) |
| CSS | `css/theme.css` (tokens), `css/app.css`, `css/vault.css` (VaultBook/Tally-style layer, loaded last, `--vb-*` tokens), `css/reports.css`, `css/nav.css`, `css/windows.css` |
| Vendor (offline, kept) | `js/vendor/` (pdf.js, SheetJS reader, tesseract OCR, statement-engine) |

---

## 5. Tests (run before and after every change)

Run from the repo root (`VaultBook-1.51.0/`):

```
node app/tests/run-node.js                                         # 149 passed (engine, PDF, invoice layout, IIF round trip, workbook…)
python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"      # 191 passed
python3 app/tests/dev/vaultbook_ui.py   "$PWD/app/index.html"      # 40 passed
python3 app/tests/dev/designer_ui.py    "$PWD/app/index.html"      # 40 passed
python3 app/tests/dev/migrate_ui.py     "$PWD/app/index.html"      # 38 passed
python3 app/tests/dev/qbo_ui.py         "$PWD/app/index.html"      # 15 passed (QuickBooks Online Excel files; needs openpyxl)
python3 app/tests/dev/studio_ui.py      "$PWD/app/index.html"      # 40 passed (top bar, home, + New menu, registers, Gateway)
python3 app/tests/dev/workbook_ui.py    "$PWD/app/index.html"      # 18 passed
python3 app/tests/dev/invoice_ui.py     "$PWD/app/index.html"      # 17 passed (print/PDF fonts, 49 lines, logo, IIF dialog)
python3 app/tests/dev/qbinvoice_ui.py   "$PWD/app/index.html" [shot.png]  # 22 passed (entry screen; also saves a dark screenshot)
python3 app/tests/dev/salestax_ui.py    "$PWD/app/index.html" [prefix]    # 30 passed (sales tax, estimate→invoice, PO→bill, closing password, audit chain)
python3 app/tests/dev/workbook_check.py …                          # LibreOffice recalculation check (needs LibreOffice)
AXE_JS=<path>/axe.min.js python3 app/tests/dev/a11y_audit.py …     # needs axe-core from npm
```

- Some dev scripts read the app path from `sys.argv`, and others default to it.
- Playwright needs Chromium. pdfplumber, Pillow and LibreOffice are used by some checks.
- The app's CSP forbids string-eval, so tests poll `location.hash` instead of using `wait_for_function` with strings, except where noted.

python3 app/tests/dev/business_ui.py "$PWD/app/index.html" [prefix]   # 18 passed (1.14: deposits, checks, write-off, finance charges, 1099)

python3 app/tests/dev/inventory_ui.py "$PWD/app/index.html" [prefix]  # 20 passed (1.15: inventory, fixed assets)

python3 app/tests/dev/projects_ui.py "$PWD/app/index.html" [prefix]   # 14 passed (1.16: jobs, billable costs, attachments, tax lines)

python3 app/tests/dev/sales_ui.py "$PWD/app/index.html"            # 14 passed (1.17: progress invoicing, SO, deposits, price levels, batch)

python3 app/tests/dev/taxreports_ui.py "$PWD/app/index.html"       # 11 passed (1.18: combined tax, pay sales tax, new reports)

python3 app/tests/dev/txdetail_ui.py "$PWD/app/index.html"        # 9 passed (1.18.7: drill to Transaction Detail By Account)

**Results (1.24.0):** Node 147/147; qbo_ui 15/15, migrate_ui 38/38, tally_ui 32/32, vaultbook_ui 45/45, bankfeed_ui 42/42. Other browser suites not re-run for this release (no change to their screens).

**Results (1.25.0):** Node 149/149; every browser suite in app/tests/dev re-run green, including the new studio_ui 26/26.

**Results (1.25.1):** Node 149/149; every browser suite re-run green, studio_ui 40/40.

**Results (1.26.0):** Node 151/151; qbo26_ui 29/29; every browser suite re-run green.

**Results (1.26.1):** Node 152/152; qbo26_ui 37/37; every browser suite re-run green.

**Results (1.26.2):** Node 154/154; qbo26_ui 40/40; every browser suite re-run green.

**Results (1.27.0):** Node 158/158; find_ui 21/21; every browser suite re-run green.

**Results (1.27.1):** Node 158/158; qbo26_ui 42/42; bank and core suites re-run green.

**Results (1.27.2):** Node 159/159; bankplus_ui 19/19; every browser suite re-run green.

**Results (1.27.3):** Node 160/160; qbo26_ui 46/46; every browser suite re-run green.

**Results (1.28.0):** Node 160/160; qbo26_ui 47/47; bankfeed_ui 42/42. Connector script not run here (needs Windows + QuickBooks).

**Results (1.29.0):** Node 164/164; mis_ui 12/12; qbo26_ui 47/47.

**Results (1.29.1):** Node 166/166; mis_ui 19/19; designer_ui, workbook_ui, bankplus_ui, txdetail_ui green.

**Results (1.29.2):** Node 167/167; mis_ui 22/22.

**Results (1.30.0):** Node 170/170; qbsend_ui 16/16; e2e, vaultbook_ui, studio_ui, qbo26_ui, bankfeed_ui green. PowerShell script not run here.

**Results (1.31.0):** Node 174/174; qbsend_ui 23/23; e2e 192; vaultbook_ui 45. PowerShell not run here.

**Results (1.32.0):** Node 178/178; qbd_ui 13/13; qbsend_ui 23; migrate_ui 38; e2e 192; vaultbook_ui 45; studio_ui 40; qbo26_ui 47. PowerShell not run here.

**Results (1.33.0):** Node 187/187; payroll_ui 27/27 (real OCR); qbd_ui 13; qbsend_ui 23; mis_ui 22; studio_ui 40.

**Results (1.33.1):** Node 188/188; paystub_iif_ui 15/15 (offline, real OCR); payroll_ui 27/27.

**Results (1.34.0):** Node 192/192; payroll_ui 29/29; paystub_iif_ui 20/20 (real OCR).

**Results (1.34.1):** Node 193/193; paystub_iif_ui 23/23.

**Results (1.35.0):** Node 193/193; payroll_ui 38/38 (real OCR); paystub_iif_ui 23/23.

**Results (1.36.0):** Node 193/193; e2e 192/192; all 26 browser suites pass.

**Results (1.37.0):** Node 194/194. The PowerShell changes are NOT executed here (no PowerShell, no QuickBooks).

**Results (1.37.1):** Node 194/194; bankfeed_ui 43; payroll_ui 38; paystub_iif_ui 23; salestax_ui 30; e2e 192.

**Results (1.38.0):** Node 196/196; qbsend_ui 26; qbd_ui 13. PowerShell not executed here.

**Results (1.38.1):** Node 197/197; migrate_ui 38.

**Results (1.38.2):** Node 198/198; migrate_ui 38.

**Results (1.39.0):** Node 198/198; txdetail_ui 16; vaultbook_ui 45.

**Results (1.40.0):** Node 199/199; txdetail_ui 22; vaultbook_ui 45; tally_ui 32; qbo26_ui 47; designer_ui 40; studio_ui 40.

**Results (1.40.1):** Node 199/199; txdetail_ui 22.

**Results (1.41.0):** Node 200/200; txdetail_ui 24; migrate_ui 38; vaultbook_ui 45.

**Results (1.41.1):** Node 201/201; migrate_ui 38.

**Results (1.42.0):** Node 206/206; intel_ui 14; vaultbook_ui 45; studio_ui 40; txdetail_ui 24; find_ui 21.

**Results (1.42.1):** Node 206/206; intel_ui 14.

**Results (1.43.0):** Node 207/207; migrate_ui 38; vaultbook_ui 45.

**Results (1.44.0):** Node 208/208; migrate_ui 38; vaultbook_ui 45.

**Results (1.45.0):** Node 212/212; hints_ui 9; bankfeed_ui 43.

**Results (1.45.1):** Node 213/213; hints_ui 9.

**Results (1.45.2):** Node 219/219; hints_ui 12; bankfeed_ui 43; bankplus_ui 19.

**Results (1.46.0):** Node 226/226; close_ui 18; hints_ui 12; bankfeed_ui 43; bankplus_ui 19; txdetail_ui 24; intel_ui 14; e2e 192.

**Results (1.47.0):** Node 232/232; qbupdate_ui 13; qbsend_ui 26; qbd_ui 13; e2e 192. Connector changes not run on Windows here.

**Results (1.47.1):** Node 239/239; sheets_ui 52; bankfeed_ui 43; bankplus_ui 19; studio_ui 40; qbo26_ui 47; txdetail_ui 24; e2e 192.

**Results (1.48.0):** Node 246/246; paste_ui 16; e2e 192; migrate_ui 38; qbd_ui 13; bankfeed_ui 43; txdetail_ui 24.

**Results (1.48.1):** Node 249/249; paste_ui 19; e2e 192.

**Results (1.49.0):** Node 256/256; docs_ui 15; close_ui 18; paste_ui 19; txdetail_ui 24; migrate_ui 38; e2e 192.

**Results (1.50.0):** Node 262/262; calendar_ui 17; docs_ui 15; paste_ui 19; bankfeed_ui 43; close_ui 18; e2e 192.

**Results (1.50.1):** Node 264/264; calendar_ui 26; e2e 192; bankfeed_ui 43; paste_ui 19; docs_ui 15; qbd_ui 13.

**Results (1.50.2):** Node 265/265; dates_ui 5; sheets_ui 52; calendar_ui 26; studio_ui 40; e2e 192; qbo26_ui 47; txdetail_ui 24; bankfeed_ui 43; docs_ui 15; close_ui 18.

**Results (1.50.3):** Node 265/265; dates_ui 6; calendar_ui 26; docs_ui 15; studio_ui 40; close_ui 18.

**Results (1.50.4):** Node 265/265; e2e 192; studio_ui 40; designer_ui 40; qbo26_ui 47; calendar_ui 26; paste_ui 19; docs_ui 15; close_ui 18.

**Last results (1.18.0):**
- Node 79/79
- e2e 191/191, vaultbook_ui 40/40, designer_ui 40/40, migrate_ui 38/38, workbook_ui 18/18
- invoice_ui 17/17, qbinvoice_ui 22/22, salestax_ui 30/30, business_ui 18/18, inventory_ui 20/20, projects_ui 14/14, sales_ui 14/14, taxreports_ui 11/11
- axe NOT RUN (npm was unreachable)

---

## 6. Tools used

- **ponytail skills** from https://github.com/DietrichGebert/ponytail.git, a "lazy senior dev" mode: smallest complete change, short replies. Install ponytail, ponytail-debt, ponytail-review and ponytail-audit in the new account if wanted.
- `CLAUDE.md` mentions a code-review-graph MCP server. It is optional; if it isn't connected, just read the source.

---

## 7. Open items and next steps

- **US feature round (1.14–1.18) is complete** — see `docs/US_FEATURE_AUDIT.md`. The user chose NOT to build: time tracking/mileage, multi-user roles, early-payment discounts, payroll, bank feeds, emailing, multi-currency, consolidation, NACHA/positive pay, loan amortization. Ask before starting any of those.
- **ERD-007:** .iif with sales tax (AUTOSTAX column) in real QuickBooks Desktop.
- **INV-005:** import an exported .iif into real **QuickBooks Desktop**, on a backup copy of the company file. Not possible in the sandbox.
- **XW-007:** open the financial workbook and the Excel exports in real **Microsoft Excel**.
- **Accessibility audit:** axe has not been run since 1.10 because it couldn't be downloaded.
- **Still open in `docs/IMPLEMENTATION_PLAN.md`:**
  - ENTRY-002/004–007: other entry screens. They could follow the invoice pattern if the user wants QuickBooks-style bills, payments and so on.
  - REPORT-002…006
  - MOD-001…006
  - BUG-001/003/005
  - DOC-001 (`app/README.txt` header is stale; SCHEMA.txt updated in 1.13)
  - MIG-005, FR-007
  - QA-001…006
- **Known limits:**
  - PDF fonts are not embedded; characters outside Windows-1252 print as "?".
  - The sample invoice's embedded license table is not reproduced (only text lines are supported).
  - Workbook aging and journal lines are export-date snapshots.

## 8. Lessons from earlier sessions (avoid repeating)

- LibreOffice `--convert-to` does **not** recalculate formulas. Use `app/tests/dev/lo_recalc.py` (UNO `calculateAll`).
- In JS, `String.prototype.link` exists, so check `typeof cell === 'object' && cell.link`.
- A `display:flex` table cell breaks column widths; wrap the content in a div (see `.qi-wrap`).
- `.lines-table td` rules from `app.css` and `vault.css` win over plain `.qbi-lines td`; scope rules with `.qbi .qbi-lines …`.
- `.menu-wrap .menu` opens upward by default. The invoice toolbar menu is overridden to open downward.
- Large workbooks need DEFLATE (94.6 MB down to 7.3 MB).
- Keep the CRLF files as CRLF when editing them with scripts.
