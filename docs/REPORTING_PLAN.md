# Financial reporting upgrade — audit, gaps and phased plan (FR-*)

> Session 4, 2026-11-04. Scope: "Enterprise Financial Reporting & Statement Designer" request.
> Rule: reuse the existing engine (`reports.js`, `statements.js`) — no second calculation engine.

## 1. Audit of what already exists (from source)

| Area | Already in 1.9.0 | Where |
|---|---|---|
| Ledger data | Integer cents, double-entry splits, split index, cash basis by allocating payments across paid documents | `ledger.js`, `reports.js` `R.entries` |
| Fiscal periods | Fiscal year start month; period columns day/week/month/quarter/year; ranges (this month … last FY) | `statements.js` `R.periodsEx`, `ui-core.js` `UI.ranges` |
| Statement engine | P&L, Balance Sheet, Budget vs Actuals as one column model × row tree; sub-account rollups; class/customer/vendor columns; PY, PP, YTD, PY YTD, $ / % change, % of row/column/income/expense; active/all/non-zero rows and columns | `statements.js` `R.statement` |
| Other reports | Trial Balance, General Ledger, Journal, Cash Flow (indirect), A/R & A/P aging (summary + documents), open invoices / unpaid bills, customer/vendor balance summary + detail, sales by customer / item, expenses by vendor, deposit / check detail, 1099, lists | `reports.js`, `ui-reports.js` |
| Screen | QuickBooks-style statement view: collapsible groups, sort, drill-down to GL, Customize (filters, number format, titles, header/footer, gridlines, banding), view density/zoom, notes | `ui-statements.js` |
| Memorized reports | Save / rename / delete; stored in the `reports` store (in backups) | `ledger.js` `saveReport`, Reports › My reports |
| Custom builder | Transaction-line report: columns, filters, grouping, sorting, save | `statements.js` `R.builder`, `ui-builder.js` |
| Exports | CSV; Excel via own dependency-free writer (`xlsx.js`: bold + money format only); PDF = browser print | `ui-core.js` `UI.exportMatrix` |
| Checks | TB debits = credits; BS balances; cash flow reconciles; aging ties to A/R / A/P | individual reports |

## 2. Gaps against the request

| # | Requested | Gap | Plan |
|---|---|---|---|
| 1 | Central engine, reconciliation | Checks exist per report but nothing proves all reports tie to the ledger together | FR-002 `R.reconcile` + "Report reconciliation" report |
| 2/5 | Visual designer, JSON templates, account mapping, formulas, conditional styles, import/export | Missing (Statement Writer's core) | FR-005/006 template engine + designer screen |
| 3 | Advanced statements | Present (P&L, BS, CF, GL, TB, aging, BvA, comparatives, sales/vendor) | Keep; designer covers management reports |
| 4 | MTD / QTD / YTD | YTD and PY YTD exist; MTD / QTD missing | FR-001 |
| 6 | Real paginated PDF | Print only; no PDF file, page numbers or repeating headers | FR-004 own PDF writer |
| 7 | Excel: formulas, sheets, merges, frozen panes, print settings, styles | Writer has 5 fixed styles only | FR-003 extend `xlsx.js` |
| 9 | Shared model → adapters | Screen and Excel each walk the tree separately | FR-003 `report-model.js` used by screen number formatting, Excel and PDF (CSV keeps its existing matrix path) |
| 10 | Identical figures on screen / PDF / Excel | Not tested | FR-003/004 tests compare all three |

## 3. Open-source research decision (DEC-013)

| Library | Licence | Fit for browser-only, file://, no build | Decision |
|---|---|---|---|
| JasperReports | LGPL/AGPL, Java server | No (needs a JVM/server) | Not used; its band model (title/page header/detail/page footer) is the PDF layout model |
| SheetJS 0.18.5 (bundled) | Apache-2.0 Community | Reads/writes data, **Community edition does not write cell styles** | Kept for reading statements; not used for styled output |
| ExcelJS | MIT | Works, ~1 MB extra | Not needed: own `xlsx.js` already writes OOXML; styles/merges/freeze/formulas/print setup are small additions |
| jsPDF / pdfmake | MIT | Work offline; 350 KB – 2 MB with fonts | Not needed: financial reports use standard Helvetica (no embedding); own writer ~250 lines with exact pagination control |
| AG Grid Community / Tabulator | MIT | Work, but replace the existing statement table | Not used: would duplicate the existing, accessible, keyboard-tested table |

npm was not reachable from the build sandbox (403), which made zero new dependencies the practical choice too. Helvetica widths come from Adobe's core-font AFM metrics (copied as numbers, with credit).

## 4. Phases — status 2026-11-04 (evidence in IMPLEMENTATION_PLAN Phase 8) (each: code → tests → docs)

| ID | Phase | Acceptance | Status |
|---|---|---|---|
| FR-001 | MTD / QTD compare columns (P&L) | Values equal a P&L run for the month/quarter to date | PASS |
| FR-002 | `R.reconcile` + report | TB, BS, P&L net, cash flow, A/R, A/P all tie; shown as a report | PASS |
| FR-003 | Shared model + Excel engine | Formulas (SUM subtotals, net rows) whose results equal the cached engine values; merges, frozen panes, print titles, fit-to-width, styles | PASS |
| FR-004 | PDF engine | Valid PDF; repeating header; Page X of Y; paper size / orientation; numbers identical to screen text | PASS |
| FR-005 | Template engine | JSON definition + schema, validation (syntax, unknown rows, cycles, duplicate ids), account mapping (types, numbers, ids, rest), unmapped/duplicate account audit, conditional styles | PASS |
| FR-006 | Designer screen | Rows add / edit / drag-drop / keyboard reorder, live preview, save to My reports, import / export JSON, Excel / PDF / print | PASS |

Not in this pass (named, not hidden): drag-and-drop of columns (columns come from period / comparison choices), images/logos in PDF headers (the company record has no logo field), per-cell formulas across columns, multi-company consolidation.
