# Resume Protocol — VaultBook AI Coding Agent

> Purpose: resume work after a context reset, session end, credit limit, or tool interruption with minimal rereading and minimal token use.
> This file is a checkpoint protocol, not persistent AI memory. It works only if the coding agent can read and write project files and the files remain in the repository.

## Fast Resume: Read Only These First

At the start of a resumed session, read in this order:

1. `AGENTS.md` — non-negotiable rules.
2. `docs/RESUME.md` — this protocol and latest compact checkpoint.
3. `docs/PROJECT_STATE.md` — current task, exact next action, tests and blockers.
4. The specific source files named under **Next action** in `docs/RESUME.md`.

Do **not** reread the entire product specification, every source file, or the full audit log on every resume. Read `docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`, and `docs/SCREEN_INVENTORY.md` only when the current task depends on them, when the checkpoint is unclear, or when verifying a requirement. If checkpoint files conflict with the actual repository, trust the code and test evidence, then correct the files.

## Session Start Procedure

1. Inspect `git status --short` and the current diff if Git is available.
2. Read the compact checkpoint below and the `PROJECT_STATE.md` next-action section.
3. Open only the files needed for the next task.
4. Verify the task is still unfinished and its dependencies still pass.
5. Continue from the exact next action; do not restart planning or redo completed work without evidence it is needed.

## Compact Checkpoint — Update Every Session

- **Product:** VaultBook 1.11.0 (data format 4) — app in `app/`, docs in `docs/`
- **Current phase:** Phase 9 financial workbook (XW-001…006 PASS); Phase 8 reporting PASS
- **Current task ID:** XW-007 / FR-003 / FR-004 real Microsoft Excel and printer verification
- **Task status:** PASS in automation; NEEDS VERIFICATION in real Excel
- **Last verified repository commit/branch:** `master`, see `git log`
- **Last verified test result:** 2026-11-04 — Node 54/54; workbook_check 48/48 (LibreOffice UNO recalculation); workbook_ui 18/18; designer_ui 40/40; e2e 191/191; vaultbook_ui 40/40; migrate_ui 38/38
- **Files changed in latest session:** new `workbook.js`, `tests/dev/{workbook_ui,workbook_check,lo_recalc}.py`; `xlsx.js`, `ui-reports.js`, `ui-palette.js`, docs (PROJECT_STATE session 5)
- **Current blocker:** no Microsoft Excel in the sandbox; npm/CDN blocked
- **Exact next action:** see PROJECT_STATE "Exact next action".
- **Files likely needed next:** `app/js/workbook.js`, `app/js/xlsx.js`, `app/tests/dev/workbook_check.py`.
- **Do not do yet:** never rename storage identifiers; keep `R.entries`/`R.statement` the only calculation path (DEC-013, DEC-015); verify formulas with `lo_recalc.py` (plain soffice conversion does not recalculate).

Update this compact checkpoint whenever task ownership, task status, tests, blockers, or the next action changes. Keep it short enough to read quickly.

## Audit Log

Append a short entry after each meaningful implementation or verification step. Do not duplicate full source code, full prompts, or entire specifications in this log.

Format:

### YYYY-MM-DD — TASK-ID — short title
- **Change:** What actually changed.
- **Files:** Relevant paths only.
- **Verification:** Exact test command and actual result, or `NOT RUN` with reason.
- **Status:** `PASS`, `FAIL`, `BLOCKED`, or `NEEDS VERIFICATION`.
- **Risks/blockers:** Only current material issues.
- **Next action:** One precise action.

Keep each entry concise. If the log becomes long, archive older entries into `docs/audit-log/archive/` by month, preserving the latest 10 entries in this file. Do not read the archive during normal resume unless investigating a historical decision or regression.

## Before Interruption / Credit Limit / Session End

Before stopping, if tool access still works:

1. Stop starting new features.
2. Save all valid code changes.
3. Run the smallest relevant test set if feasible; do not claim unrun tests passed.
4. Update the task status in `docs/IMPLEMENTATION_PLAN.md`.
5. Update `docs/PROJECT_STATE.md` with changed files, exact tests/results, unresolved issues, and next action.
6. Update the compact checkpoint in this file.
7. Append a concise audit-log entry.
8. If Git is available, create a checkpoint commit only when the current changes are coherent and safe. Never commit secrets or unverified destructive changes. Follow the project's normal commit policy.
9. End with a concise handoff summary.

If the limit is reached abruptly and no final write is possible, the next session must inspect the actual repository diff and reconstruct the checkpoint from files and code. Never assume the last operation completed successfully.

## Token-Saving Rules

- Use this resume file as an index, not as a replacement for evidence.
- Read the compact checkpoint, then only the files relevant to the next task.
- Do not paste the full product specification into chat if it already exists in the repository.
- Do not reprint the whole audit history; summarize only the latest checkpoint.
- Avoid repeatedly scanning the entire repository. Search targeted paths and inspect relevant files.
- Do not repeat completed tasks unless tests or source changes show they need revisiting.
- Keep task scopes small and acceptance criteria explicit.
- Summarize findings in project files instead of carrying long conversational context.
- Prefer deterministic scripts and automated tests over lengthy manual explanations where available.
- A saved checkpoint reduces repeated context; it does not eliminate tokens needed to understand code or run tools.

## Required Resume Response

After resuming, the agent should report internally/briefly:
- Task resumed
- Current verified state
- Next action
- Test status

Then proceed with work; do not ask the user to repeat the mission unless a real decision is missing.

## Important Limit

This file cannot automatically wake up an AI, bypass credit/token limits, or guarantee background execution. When credits or access return, the coding tool or user must start/resume the agent. The protocol makes that resume cheaper and more reliable by storing a compact, auditable checkpoint in the repository.

### 2026-10-22 — AUD-001…005 — Audit and baseline
- **Change:** Git repo created (baseline = unmodified zip). Architecture, storage, shortcuts and screens audited; e2e harness updated for 1.7.0 UI.
- **Files:** `docs/AUDIT_BASELINE.md`, `docs/SCREEN_INVENTORY.md`, `docs/IMPLEMENTATION_PLAN.md`, `app/tests/dev/e2e_playwright.py`
- **Verification:** `node app/tests/run-node.js` 39/39; e2e 186/186 after harness fix (flaky BUG-001 in some runs); axe 8 issue types.
- **Status:** AUD-001/002/003/005 PASS; AUD-004 NEEDS VERIFICATION.
- **Risks/blockers:** BUG-001 flaky; no real Windows/macOS test.
- **Next action:** Runtime-open every inventoried dialog.

### 2026-10-22 — BUG-002 — Window tabs discarded unsaved entries
- **Change:** Window focus/close-active/close-others/close-all/cycle/new-tab go through `UI.confirmLeave`.
- **Files:** `app/js/ui-windows.js`, `app/tests/dev/e2e_playwright.py`
- **Verification:** 4 new e2e checks fail on old code, pass on new (3 runs); Node 39/39.
- **Status:** PASS
- **Risks/blockers:** None new.
- **Next action:** AUD-004 runtime dialogs.

### 2026-10-22 — NAV/KEY/CFG/UI — Tally-inspired VaultBook workspace
- **Change:** Research (35 refs) → design system, Gateway + sub-menus, key registry + F-key panel, command menus, F11/F12, entry strip, row cursor + Esc back, visible rename, axe fixes.
- **Files:** see PROJECT_STATE session 2.
- **Verification:** Node 39/39; vaultbook_ui.py 40/40; e2e 190/190; axe 0.
- **Status:** PASS for FOUND-002/005/006, NAV-002/003/004, CFG-001/002/003, A11Y-001/002, BRAND-001, BUG-004; others NEEDS VERIFICATION.
- **Risks/blockers:** real-browser F-key reservations unverified.
- **Next action:** real-browser QA-002 path.

### 2026-11-04 — MIG-001…004, ITEM-001, REPORT-008/009 — QuickBooks migration
- **Change:** Import a whole company from QuickBooks Desktop exports; products/services; 11 QuickBooks-standard reports incl. Open Invoices in Reports; data format 4.
- **Files:** `app/js/qbimport.js`, `ui-migrate.js`, `ui-items.js`, `ledger.js`, `reports.js`, `ui-reports.js`, `schema.js`, `db.js`, tests.
- **Verification:** Node 45/45; migrate_ui 38/38; e2e 190/190; vaultbook_ui 40/40; axe 0; v3→v4 browser upgrade OK; real export 66/66 balances equal.
- **Status:** PASS (CONTACT-001 NEEDS VERIFICATION)
- **Risks/blockers:** inventory quantities not tracked; oldest-first applications for unreferenced payments.
- **Next action:** real-browser run of #/migrate on a copy of a real export.

### 2026-11-04 — FR-001…006 — Financial reporting upgrade (1.10.0)
- **Change:** MTD/QTD columns; Report Reconciliation; shared report model; Excel formulas/merges/freeze/print setup; offline PDF writer for every report; statement designer (JSON templates, account mapping, formulas, styles, highlights, audit, import/export).
- **Files:** `app/js/{pdf,report-model,designer,ui-designer}.js` (new); `statements.js`, `xlsx.js`, `ui-core.js`, `ui-statements.js`, `ui-reports.js`, `ui-builder.js`, `css/reports.css`, tests, docs.
- **Verification:** Node 52/52; designer_ui 40/40; e2e 191/191; vaultbook_ui 40/40; migrate_ui 38/38; LibreOffice recalculation 0 diffs; qpdf clean. axe NOT RUN (blocked download).
- **Status:** PASS (automation); real Excel/printer NEEDS VERIFICATION.
- **Risks/blockers:** standard PDF fonts only (WinAnsi); no PDF logos.
- **Next action:** open exports in real Excel; print a multi-page PDF.

### 2026-11-04 — XW-001…006 — Export financial workbook (1.11.0)
- **Change:** One linked, formula-driven Excel workbook per company (14 sheets), date cells that re-run every report, drill-down links, tables, filters, groups, chart, optional protection, compression.
- **Files:** `app/js/workbook.js` (new), `xlsx.js`, `ui-reports.js`, `ui-palette.js`, tests, docs.
- **Verification:** Node 54/54; workbook_check 48/48; workbook_ui 18/18; full regression green. Also corrected the session 4 LibreOffice evidence (real recalculation now used).
- **Status:** PASS (automation); real Excel NEEDS VERIFICATION.
- **Risks/blockers:** journal/ledger lines and aging are export-period snapshots.
- **Next action:** open a workbook in Microsoft Excel.

### 2026-11-04 — INV-001…004 — Invoices (1.12.0)
- **Change:** Classic invoice print/PDF matched to the user's sample; optional logo; .iif export (many or one invoice); invoice entry screen laid out like QuickBooks Desktop Create Invoices with customer messages.
- **Files:** `app/js/{invoice-layout,qbexport}.js` (new); `ui-forms.js`, `ui-pages.js`, `ui-settings.js`, `ui-palette.js`, `ledger.js`, `pdf.js`, `css/app.css`, tests, docs.
- **Verification:** Node 57/57; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22. axe NOT RUN.
- **Status:** PASS (automation); real QuickBooks import NEEDS VERIFICATION.
- **Risks/blockers:** non-embedded fonts; sample's embedded license table not reproduced.
- **Next action:** import an exported .iif into QuickBooks Desktop (on a backup copy).

### 2026-11-04 — INV-004 follow-up — Invoice screen in VaultBook theme (1.12.1)
- **Change:** `.qbi-*` styles now use VaultBook tokens only (light/dark); layout and behaviour unchanged; print/PDF unchanged.
- **Files:** `app/css/app.css`, `app/tests/dev/qbinvoice_ui.py` (dark screenshot), `schema.js`, docs.
- **Verification:** Node 57/57; e2e 191/191; vaultbook_ui 40/40; invoice_ui 17/17 (PDF fonts/lines unchanged); qbinvoice_ui 22/22.
- **Status:** PASS
- **Next action:** import an exported .iif into QuickBooks Desktop.

### 2026-11-05 — ERD-001…006 — ER-design audit follow-up (1.13.0)
- **Change:** Audit (`docs/ERD_AUDIT.md`); sales tax end to end; estimates and purchase orders; hash-chained audit trail; closing-date history and password; credit-limit warning; data format 5.
- **Verification:** Node 63/63; e2e 191/191; vaultbook_ui 40/40; designer_ui 40/40; migrate_ui 38/38; workbook_ui 18/18; invoice_ui 17/17; qbinvoice_ui 22/22; salestax_ui 30/30.
- **Status:** PASS (automation); .iif sales tax import into real QuickBooks NEEDS VERIFICATION.
- **Next action:** ask the user which of ERD-008 (inventory), ERD-009 (jobs/discounts/price levels) and ERD-010 (attachments/checks/NACHA/users) to build next.

### 2026-11-05 — US-001…005 — 1.14.0
- **Change:** Make Deposits; check printing; 1099 W-9/recipient copies/1096 totals/CSV; bad debt write-off; finance charges; StudioBooks text fixed.
- **Verification:** Node 68/68; all browser suites pass (business_ui 18/18).
- **Next action:** 1.15 inventory (qty on hand, average cost, COGS, adjustments, valuation) and fixed assets/depreciation.

### 2026-11-05 — US-007…009 — 1.15.0
- **Change:** perpetual inventory at average cost; valuation and stock status; fixed assets with SL/DDB/MACRS depreciation; data format 6.
- **Verification:** Node 70/70; all browser suites pass (inventory_ui 20/20).
- **Next action:** 1.16 attachments, tax-line mapping, Customer:Job, billable expenses.

### 2026-11-05 — US-011…014 — 1.16.0
- **Change:** attachments; Customer:Job; billable costs; tax-line mapping + Income Tax Summary; data v7, IndexedDB v5.
- **Verification:** Node 73/73; all browser suites pass.
- **Next action:** 1.17 sales orders, progress invoicing, batch invoicing, customer deposits/retainers, price levels.

### 2026-11-05 — US-015…019 — 1.17.0
- **Change:** sales orders; progress invoicing; batch invoicing; customer deposits; price levels; data v8.
- **Verification:** Node 77/77; all browser suites pass.
- **Next action:** 1.18 sales tax codes/returns/payments/certificates; A/R Collections, Missing Checks, Voided/Changed, Cash Flow Forecast reports.

### 2026-11-05 — US-020…022 — 1.18.0 (US feature round complete)
- **Change:** combined sales tax by agency, return by agency, Pay Sales Tax, exemption certificates, contact attachments; A/R Collections, Missing Checks, Voided/Changed, Cash Flow Forecast.
- **Verification:** Node 79/79; all 13 browser suites pass.
- **Next action:** ask the user; see `docs/US_FEATURE_AUDIT.md` for what is open.

### 2026-11-05 — UX-030 — 1.18.1 design polish
- **Change:** Impeccable audit; 11px text floor, side stripes removed, nested cards removed, single active sidebar group, dashboard bank card widened, larger page titles.
- **Verification:** see HANDOFF test list; detector rescan in docs/DESIGN_AUDIT.md.
- **Next:** optional `/impeccable init` to write PRODUCT.md / DESIGN.md.

### 2026-11-05 — UX-031 — 1.18.2 tighter entry screens
- **Change:** invoice header from three bands to two; compact horizontal toolbar; type badge dropped where the page title says it; tab strip no longer squeezed; Billable column and Print later fixed.
- **Verification:** Node 79/79 and all browser suites (see HANDOFF).

### 2026-11-05 — UX-032 — 1.18.3 invoice ribbon
- **Change:** QuickBooks-style ribbon (big + stacked buttons) replaces the toolbar and More menu on invoice/estimate/sales order; function-key panel folds to an edge tab.
- **Verification:** Node 79/79; e2e 192; all other suites pass.

### 2026-11-05 — UX-033 — 1.18.4
- **Change:** QuickBooks Desktop report face; item type-ahead; Esc quits entries with keyboard-driven dialog (bug fixed: dialog was dismissed by the same keypress); Home/Close window controls.
- **Verification:** Node 79/79; e2e 192; vaultbook_ui 45; all other suites pass.
- **Open:** floating/resizable side-by-side windows not built (one screen renders at a time).

### 2026-11-05 — UX-034 — 1.18.5
- **Change:** unsaved-changes dialog shows K / D / S underlined on its buttons; no hint text.
- **Verification:** Node 79/79; e2e 192; vaultbook_ui 45; designer, business, qbinvoice pass.

### 2026-11-05 — UX-035 — 1.18.6
- **Change:** grey margins and boxed frames removed on entry screens and all reports.
- **Verification:** Node 79/79; all browser suites pass.

### 2026-11-05 — RPT-040 — 1.18.7
- **Change:** Transaction Detail By Account report and drill from every statement total; no statement gridlines; hover/click/keyboard row open.
- **Verification:** Node 79/79; all 13 browser suites; new txdetail_ui 9/9.

### 2026-11-05 — UX-036 — 1.18.8
- **Change:** single shared row highlight for mouse and keyboard.
- **Verification:** Node 79/79; all browser suites; txdetail_ui 10/10.

## Resume after 1.19.0
CPA audit plan complete. Next: anything the user asks. New engine APIs: saveTransactions (atomic), warnings, receiveWithDiscount, recordBouncedPayment, disposeFixedAsset, voidTransaction(id, reason, {asOf}), applyCredit, refundDeposit, recostInventory.

## Resume after 1.20.0
Bank feed shipped. Next from the audit: rules v2 (conditions, splits, auto-add, preview), grouped deposits (subset sum), reconcile adjustment + frozen report + search.

## Resume after 1.21.0
Bank feed + QuickBooks export shipped. Next from the audit: rules v2, grouped deposits, reconcile adjustment + report.

## Resume after 1.22.0
TallyPrime-style keyboard work, registers and Reclassify Transactions shipped. Still open from the bank audit: rules v2, grouped deposits, reconcile adjustment + report.

## Resume after 1.23.0
All three bank items from the audit are in (rules v2, grouped deposits, reconcile adjustment + report), plus import matching of entries already in the books. Next ideas: a "possible match, amount differs" hint, rules that match a payee from the bank text.

## Resume after 1.24.0
QuickBooks Online Excel sets import whole (Journal + Balance Sheet + P&L + Trial Balance + contact lists) and a company can be created straight from the files. Not done: a General Ledger with only an Amount column (asks for Debit/Credit or the Journal), QBO account numbers shown inside names, invoices' item lines (the Journal has no items), reconciliation marks. Engine Lab (separate, /home/claude/enginelab) is at 0.4.0 and waits for packs from more clients.

## Resume after 1.25.0
The G1–G3 look is applied app-wide. Possible next steps: Company Snapshot chart colours in the teal/yellow palette, a "Customize widgets" chooser for Business overview, and choosing which home tab opens first.

## Resume after 1.25.1
Registers have month graphs and folding options; Gateway is shorter. Next ideas: Company Snapshot chart colours, Customize widgets on Business overview.

## Resume after 1.26.0
The whole QBO research backlog (A1–A4, B1–B2, C1–C2, D1, E1–E2) is in. Not done: e-mail sending (no network; Save and send saves), a live inline Customize panel that applies without the Apply button, Pending as the For review name. Next ideas: pinned apps in the side menu, report chart for Trial Balance and aging.

## Resume after 1.26.1
One deposit can be matched to several invoices (suggested or by hand, part payments allowed). Not done: one deposit across two customers (QuickBooks also needs two payments for that).

## Resume after 1.26.2
Split payments across deposits are suggested (named customer only). Not done: several deposits paying several invoices at once (pick by hand), one deposit across two customers.

## Resume after 1.27.0
Find is in. Ideas next: bulk actions on Find results (reclassify, like Xero Find & Recode), search inside attachments' names, custom fields when they exist.

## Resume after 1.27.1
Bank feed Posted-tab click fixed.

## Resume after 1.27.2
Reconciliation report matches QuickBooks Detail/Summary. Possible next: list New Transactions after the statement date (QuickBooks shows them when the register runs past the statement).

## Resume after 1.27.3
Payments export as PAYMENT/BILLPMT with an apply list. A linked import needs a third-party tool (Transaction Pro, SaasAnt) or QuickBooks' own Receive Payments.

## Resume after 1.28.0
Connector script written and untested against real QuickBooks. Next: user's first run (check, then -Apply) on DM RADS 55,830.27 → invoice 1243; then bill payments (BillPaymentCheckAdd) and reading the result csv back into VaultBook if wanted.

## Resume after 1.29.0
Invoice Payment Days report done. Next (approved): Send to QuickBooks Desktop screen (select invoices and payments, one batch, one double-click "Send to QuickBooks.cmd" that checks, asks before creating customers/items, records; item matched by exact or leading name with the full text as the printed description; result loaded back into VaultBook).

## Resume after 1.29.1
Drill-down done (one level). Next (approved): Send to QuickBooks Desktop screen.

## Resume after 1.29.2
Income account fields done. Next (approved): Send to QuickBooks Desktop screen.

## Resume after 1.30.0
Send to QuickBooks screen + one-run script shipped (untested against real QuickBooks). Next: user's first run; then bills/bill payments in the batch (BillAdd, BillPaymentCheckAdd), and the planned payroll-from-paystubs version (see IMPLEMENTATION_PLAN "Future version").

## Resume after 1.31.0
Read + Months tab shipped; script untested against real QuickBooks (user's first run next). Then GAP-SEND: extend batch/script to bills, bill payments, checks, expenses, card charges, deposits, transfers, journal entries, credits; per-month trial-balance tie-out.

## Resume after 1.32.0
QuickBooks Desktop section + Import everything shipped; connector Export untested on a real file (user's Read worked: 133 checks, 48 deposits, 19 journals). Next: GAP-SEND for checks and deposits (this client has no invoices), then bills/bill payments/journals; per-month trial-balance tie-out in the Months view.

## Resume after 1.33.0
Payroll from paystubs shipped (#/payroll). Waiting on the user: the Jan-Mar payroll JV (or Import everything) to learn this client's accounts, the AZ SUTA rate/base, net pay to bank vs clearing, and whether April payroll exists (YTD gap). Next paystub layouts from the user extend paystub.js header/cells with new tests. Still pending: GAP-SEND (checks, deposits, bills, journals), per-month TB tie-out.

## Resume after 1.33.1
Standalone Paystub to QuickBooks IIF tool shipped (build: python3 app/tools/paystub-iif/build.py). Future: other payroll layouts (ADP etc.) from user samples — add their OCR rows as tests, extend paystub.js header/cells; both VaultBook and the tool pick it up on rebuild.

## Resume after 1.34.0
Payroll documents recognised and cross-checked (client set: 207 agree / 0 differ / 8 not provided). Next ideas: tax payment entries from EFTPS and state payments (Dr liabilities, Cr bank), per-state withholding accounts using the employee→state the cross-check finds, more document layouts as the user sends them.

## Resume after 1.34.1
Combined entry option in the standalone tool. VaultBook's own Payroll screen still posts one entry per pay date (could reuse mergeDrafts if asked).

## Resume after 1.35.0
VaultBook Payroll posts and exports .iif (per pay date or combined). Standalone tool still shipped for clients without VaultBook. Ideas: tax payment entries from EFTPS/state payments; per-state withholding accounts.

## Resume after 1.36.0
Dense ledger look shipped from the design critique. Not done yet: invoice field labels are still QuickBooks capitals (DATE, BILL TO…); one tab style everywhere; a single density setting; flyout arrow keys; bulk actions on lists. Re-run /impeccable critique to score.

## Resume after 1.37.0
Waiting for the user's run of connector option 6 and of Send with the deposit guard (first real test of both). If the report request is refused, the script retries without IncludeColumn; if still refused, get the QuickBooks message / qbsdklog.txt. Next: QB-LINK, GAP-SEND.

## Resume after 1.37.1
Date typing fix shipped. Still waiting on the user's first runs of connector option 6 and Send with the deposit guard.

## Resume after 1.38.0
First live run of bank sending is the user's: expect possible qbXML order/field errors per type (shown as FAILED with QuickBooks' message; nothing half-written). Fix from their screenshot. Then QB-AP and QB-LINK.

## Resume after 1.38.1
Import fix only. Open items unchanged: live connector runs (option 6, bank send), QB-LINK, QB-AP.

## Resume after 1.38.2
Next: aging report build once the user approves the mockup.

## Resume after 1.39.0
Next candidates: aging report (awaiting approve), two-sided statement look, PDF export following the look.

## Resume after 1.40.0
Open: aging report (awaiting approve); side panel / by-month drill; Excel does not follow layouts.

## Resume after 1.40.1
Open: aging report (awaiting approve).

## Resume after 1.41.0
Ask the user whether Ctrl+P opened the print window on their Chrome/Edge. Aging report still awaits approve.

## Resume after 1.41.1
Ask about Ctrl+P on the user's browser. Aging report awaits approve.

## Resume after 1.42.0
Ask the user: did Ctrl+P open the print window; does the on-device model link appear and work in their Chrome. Possible next: bundle a small model if the user accepts the dependency; bank-feed vendor name cleanup + similar transactions; aging report (awaiting approve).

## Resume after 1.42.1
Same open questions as 1.42.0.

## Resume after 1.43.0
Open: Ctrl+P confirmation; on-device model link; aging report approval.

## Resume after 1.44.0
Open: Ctrl+P confirmation; on-device model link; aging report approval; user to re-print GL and statements on the same day for this company.

## Resume after 1.45.0
Open: user to try Extra help on their own clients and decide; Autopilot step 1 (recent habit, safety rule, top three, review by payee) awaiting go-ahead; Ctrl+P and on-device model confirmations; aging report approval.

## Resume after 1.45.1
Open: as after 1.45.0.

## Resume after 1.45.2
Open: as after 1.45.0.

## Resume after 1.46.0
Next: 1.47 sign-off package (engagement-aware: compilation/preparation/bookkeeping) and the multi-client close dashboard. Open: Ctrl+P and on-device model confirmations; aging report approval.

## Resume after 1.47.0
Next: the user tests the link and one edit on QuickBooks; then 1.48 Close the books sign-off package and multi-client view. Open: Ctrl+P, on-device model and aging report as before.

## Resume after 1.47.1
Next: the user tests the 1.47.0 QuickBooks link on Windows; then 1.48 Close the books sign-off package and multi-client view.

## Resume after 1.48.0
Next: the user tries Paste entries and the 1.47.0 QuickBooks link; then Close the books sign-off package and multi-client view.

## Resume after 1.48.1
Next: the user tries Paste entries (and splits) and the 1.47.0 QuickBooks link; then Close the books sign-off package and multi-client view.

## Resume after 1.49.0
Next: the user tries Paste entries and Doc Center; calendar ideas under discussion; then Close the books sign-off package and multi-client view.

## Resume after 1.50.0
Next: the user tries Paste entries, Doc Center and Calendar; then Close the books sign-off package.

## Resume after 1.50.1
Next: the user tries the calendar; then Close the books sign-off package.

## Resume after 1.50.2
Next: the user tries the calendar and report dates; then Close the books sign-off package.

## Resume after 1.50.3
Next: the user tries report dates and the calendar; then Close the books sign-off package.

## Resume after 1.50.4
Next: the user picks D1 or D2 for the menu bar (design canvas); then build it with the side menu as an option.

## Resume after 1.51.0
Next: the user looks at the menu bar and colours in the real app and says what to adjust (menu contents, toolbar order, blue). Then VaultBook's own DESIGN.md, and Close the books sign-off package.

### 2026-11-23 — QBD connector — Download the QuickBooks tool (1.59.1)
- **Change:** One-click download of the connector (.cmd + .ps1 zipped by build-site.py) on Send to QuickBooks Desktop and the QuickBooks Desktop page; "tools folder" wording now links to it; .cmd warns when not extracted.
- **Files:** `app/tools/build-site.py`, `app/tools/VaultBook QuickBooks.cmd`, `app/js/ui-qbsend.js`, `app/js/ui-qbd.js`, `app/js/ui-bankfeed.js`.
- **Verification:** Node 275/275; build --check OK; Playwright download check passes. qbsend_ui/qbd_ui/bankfeed_ui fail on CSP string-eval (pre-existing, same on 1.59.0). Real Windows + QuickBooks run: NOT RUN (no Windows here).
