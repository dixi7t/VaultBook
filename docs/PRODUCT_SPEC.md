# VaultBook — Product and UX Specification

> VaultBook is the new product name for OfflineBooks US (DEC-006). Requirements below are unchanged; read "OfflineBooks US" as VaultBook.

## 1. Product goal
Create an original, professional US bookkeeping application that combines OfflineBooks US's existing accounting capabilities with a fast, keyboard-first interaction model inspired by Tally Prime. The goal is functional consistency across the entire application—not a dashboard-only visual refresh.

## 2. Product principles
- Keyboard-first, with mouse support.
- Fast, predictable navigation and data entry.
- Compact, readable accounting screens.
- Consistent screen structure, focus behavior, action placement, and terminology.
- Clear traceability from financial statements to ledgers and source transactions.
- Offline-first operation and local data ownership.
- No compromise to accounting correctness, privacy, security, or existing functionality.
- Original product identity; do not copy Tally's branding or proprietary assets.

## 3. Application shell and Gateway
Create a central Gateway/home screen with company name, financial year/accounting period, and logically grouped destinations:
- Company
- Masters
- Transactions
- Banking
- Reports
- Budgets and tracking
- Recurring transactions
- US tax/1099 features already supported
- Import/export
- Settings, security, backup and restore
- Recent destinations/activity where useful

Keep the layout compact and useful for repeated accounting work. Menus must navigate to real features. Do not add dead or placeholder menu items.

## 4. Navigation model
Implement a consistent navigation stack and context-aware menus:
- Arrow keys move through selectable menu items.
- Enter opens the selected item.
- Escape closes a dialog or returns to the previous navigation level, following predictable rules.
- Back navigation restores the prior screen's relevant state, including report filters, date range, selection, and scroll position where practical.
- Search/Go To opens supported destinations, records, reports, and actions.
- Focus is deliberately assigned when a screen opens and restored when it closes.
- Menus and dialogs remain usable with a mouse and assistive technology.

Do not override standard text selection/editing behavior while a text field is active.

## 5. Function keys and shortcuts
Build a centralized, documented, context-aware shortcut registry. Display valid shortcuts beside actions and in a searchable help/reference screen. Avoid conflicting assignments and platform/browser reserved shortcuts.

Proposed mappings, subject to existing application conflicts and tested platform behavior:
- F1: Help / shortcut reference.
- F2: Transaction date or report period, according to context.
- F3: Company selection/switching, where safe and supported.
- F4: Transfer/bank transfer, where supported.
- F5: Payment entry.
- F6: Receipt/receive payment.
- F7: Journal entry or context-specific action.
- F8: Sales invoice/receipt, according to supported transaction types.
- F9: Purchase/bill, according to supported transaction types.
- F10: Contextual More Actions.
- F11: Company Features.
- F12: Context-sensitive Configuration.
- Alt+G or another conflict-free shortcut: Go To/command palette, after platform verification.
- Escape: close/cancel/back according to active context, with unsaved-change protection.
- Ctrl/Meta+K: command palette only if compatible with the existing app and platform.

These are proposed OfflineBooks US conventions, not a requirement to reproduce every Tally shortcut exactly. Context-specific actions must be visible, predictable, documented, and tested. Never silently swallow a shortcut that a user needs for ordinary text editing.

## 6. F11 Company Features
Provide a dedicated company-level features window, only exposing settings supported by the app or implemented correctly:
- Accounting
- Customers/receivables
- Vendors/payables
- Banking/reconciliation
- Classes/departments/tracking
- Budgets
- Recurring transactions
- US 1099 tracking
- Inventory, only if supported
- Audit trail/security, where applicable

Every setting needs a clear label, description, current state, keyboard-accessible control, validation, and persistence. Turning off a feature must not delete its stored data. Prefer reversible deactivation.

## 7. F12 Configuration
Provide context-sensitive configuration:
- General/navigation preferences on Gateway.
- Entry defaults and field behavior on transaction screens.
- Columns, sorting, detail level, and display settings on reports.
- Date and currency formatting appropriate for US accounting.
- Keyboard hints, table density, compact/detailed view, confirmations, theme, accessibility.
Persist preferences in the existing local storage architecture. Do not create settings that have no implemented effect.

## 8. Contextual action panel
Show a compact action panel or toolbar that adapts to the current screen.
- Gateway: create transaction, open master/report, search.
- Entry: save, save and new, cancel, add line, select/create master, related actions.
- Registers: new, view/edit, filter, sort, search, print/export, and safe delete/void where supported.
- Reports: period, filters, configure, expand/collapse, drill down, print/export, back.

Only show valid actions. Every action must work with keyboard and mouse. Destructive actions need confirmation and must respect accounting rules.

## 9. Transaction-entry windows
Use focused, consistent entry screens tailored to each supported transaction type. Do not force all transactions into one generic form.

Possible fields, depending on transaction:
- Transaction number/date
- Customer/vendor
- Reference number, terms, due date, memo
- Account/item, description, quantity/rate if relevant
- Debit/credit where relevant
- Amount, class or tracking dimension if supported
- Calculated totals and validation
- Save, Save and New, Cancel/Close

Keyboard requirements:
- Predictable initial focus.
- Tab/Shift+Tab move through fields.
- Enter accepts a selected option or advances when appropriate; avoid surprising behavior.
- Arrow keys navigate menu/list/grid selection when focus is in that control.
- Type-to-search for accounts, customers, vendors and supported items.
- Efficient line add/edit/remove and row navigation.
- Save/cancel shortcuts that are visible and documented.
- Preserve user input after validation errors.
- Warn about unsaved changes.
- Prevent accidental duplicate posting.
- Keep date and dropdown selection keyboard accessible.

Do not alter the accounting engine's posting rules to accommodate UI shortcuts.

## 10. Registers and tables
Use reusable table behavior:
- Readable headers and selected-row states.
- Right-aligned monetary values.
- Consistent negative-number formatting.
- Sorting, filtering, search, and pagination/virtualization where appropriate.
- Keyboard row navigation and opening selected records.
- Clear empty/loading/error states.
- No data loss when filters or screens change.

## 11. Reports and drill-down
Reports should be interactive accounting workspaces, not static dashboard cards. Support existing reports such as Profit & Loss, Balance Sheet, Trial Balance, General Ledger, A/R, A/P, Cash Flow, budget comparisons, 1099 reports, and custom reports where implemented.

Provide report title, company, period/comparison period, accounting basis when supported, filters, hierarchy, subtotals, and export/print actions.

Preserve the reporting context during drill-down:
- P&L → account → ledger → transaction → transaction detail.
- Balance Sheet → account → ledger → transaction.
- Trial Balance → account → ledger → transaction.
- A/R → customer → invoice → payment/application.
- A/P → vendor → bill → payment.

Only enable paths supported by actual data and current functionality. Report values must reconcile to the accounting layer. Back should restore the previous report's period, filters, selection, and scroll state where practical.

## 12. Command palette / Go To
Search supported:
- Menus and destinations
- Transaction actions
- Customers and vendors
- Accounts/ledgers
- Transactions and reference numbers
- Reports
- Settings and supported commands

Use keyboard-selectable results, clear labels, and safe navigation. Results must open real destinations or records, not placeholder pages. Respect company context and permissions.

## 13. Visual design
- Compact desktop-first accounting workspace.
- Clear hierarchy and restrained colors.
- Consistent typography, spacing, borders, selected/focus states, and action placement.
- Dense but readable tables.
- Avoid oversized cards, unnecessary whitespace, excessive animation, and decoration that slows repetitive work.
- Retain or improve light/dark themes if they exist.
- Maintain usable responsive behavior without compromising desktop productivity.
- Original OfflineBooks US identity; no Tally logos or copied proprietary assets.

## 14. Existing architecture and data
Inspect the actual project before choosing implementation details. The known project direction is a standalone HTML/CSS/JavaScript application using IndexedDB, but verify this against source code.

Preserve:
- Existing double-entry accounting engine and financial calculations
- Database schema and migrations unless a change is necessary
- Existing stored data
- Offline operation
- Security/encryption if present
- Backup and restore
- Import/export
- Existing features and user preferences

No required external server, cloud dependency, or replacement database. Version and test any required schema migration. Make backups before risky data changes. Do not fabricate financial data or change stored records as a UI shortcut.

## 15. Accessibility and platform behavior
- Visible keyboard focus.
- Logical focus order and restoration.
- Accessible labels and names.
- Keyboard operation for controls and dialogs.
- No shortcut conflicts with text editing or system/browser behavior.
- Verify Windows and macOS behavior where feasible.
- Respect reduced-motion and theme preferences if supported.

## 16. Quality gates
A requirement is not complete merely because code exists or a screen renders. Verify:
- The intended action works end to end.
- Relevant automated tests pass.
- Accounting totals remain correct.
- Existing workflows have not regressed.
- Keyboard focus and shortcuts work in the relevant context.
- Data survives save, reload, and backup/restore where applicable.
- Offline operation remains intact.
- The requirement has evidence recorded in the implementation plan.

## 17. Definition of done
The redesign is complete only when every screen and requirement has been inventoried, implementation status is evidence-based, required acceptance tests pass, regressions are resolved or explicitly documented, and no visible action is a dead end.
