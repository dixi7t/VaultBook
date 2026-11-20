# VaultBook — Tally Prime UI Research and Design Analysis

> Research date: 2026-10-22. Method: Claude in Chrome on the official **TallyHelp** site (help.tallysolutions.com). Page text was read in the browser; screenshots were found through the site's public WordPress search/media endpoints and each image was opened and viewed in Chrome. **35 references: 34 images I inspected visually + 1 official shortcut reference page.**
> Images saved in `reference-ui/research/` are browser captures of Tally Solutions' published help images. They are © Tally Solutions, kept here only as internal design research, are **git-ignored** (not committed or shipped) and must not be used in the product. No Tally logo, asset or code is used in VaultBook.
> Limitations: animated GIFs were captured as a single frame. I did not run TallyPrime itself (no licence or install in this session). Every observation below comes from these help images and pages. Anything I could not see is marked **[assumption]**.

## 1. Reference inventory

Base URL for every image: `https://help.tallysolutions.com/wp-content/uploads/`

| ID | Category | Source (uploads path / page) | What it shows |
|---|---|---|---|
| R01 | Shortcuts (cat. 6, 19, 21) | `https://help.tallysolutions.com/keyboard-shortcuts-tally-prime/` (page text) | Official shortcut list: F1–F12, Alt+G Go To, Ctrl+A accept, Esc back, Enter drill-down, Space select, Alt+D delete, Alt+X cancel, F4–F9 vouchers |
| R02 | F11 Company Features (4) | `2020/10/1-4.png` | Two-column features form grouped (Accounting, Inventory, Taxation, Online Access, Payroll, Others); `Label : Yes/No`; focused value boxed |
| R03 | Trial Balance (13) | `2020/08/trial-balance-view-1024x550.jpg` | Title bar (report · company · ×); Particulars + Debit/Credit columns; selection bar; Grand Total; bottom button bar (Q: Quit, Space: Select, R: Remove Line, U: Restore Line) |
| R04 | Trial Balance detailed (13, 21) | `2020/08/detailed-trial-balance-1-1024x522.jpg` | Detailed (Alt+F5) view: groups bold, ledgers indented and italic; subtotals ruled; page counter "35 ▼" |
| R05 | Profit & Loss (14) | `2020/08/1-view-profit-loss.gif` | Horizontal (T-form) P&L; Nett Profit in italics; equal Totals at bottom |
| R06 | P&L detailed (14) | `2020/08/2-view-profit-loss-detailed.gif` | Detailed P&L: child amounts in an inner column, group totals in the outer column |
| R07 | Balance Sheet (15) | `2020/08/View-Balance-sheet.gif` | Liabilities / Assets halves; "as at" date under company; selection bar on a row |
| R08 | Balance Sheet multi-column (15, 18) | `2020/08/Comparing-information-in-balance-sheet.gif` | Added comparison columns, each with its own header block |
| R09 | General Ledger (16) | `2026/07/ledger-vouchers.gif` | Ledger Vouchers: Date, Particulars, Vch Type, Vch No, Debit, Credit; footer Opening / Current Total / Closing balance |
| R10 | Day Book / register (21) | `2020/08/day-book-new.jpg` | Dense register; period on the top right; Date, Particulars, Vch Type, Vch No, Debit/Credit |
| R11 | F12 Configuration for a report (5, 18, 24) | `2020/08/day-book-f12.jpg` | Small "Configuration" window: `Label : Value` list with nested options; dependent options greyed |
| R12 | Payment entry (8) | `2020/08/Single-entry-mode-cash-payment-1.gif` | Voucher window: type badge "Payment", No., date + weekday on the right; Account with current balance; Particulars/Amount lines with Cur Bal; Narration; total at the bottom |
| R13 | Payment sub-screen (8) | `2020/08/Single-entry-mode-bank-payment-5.gif` | Bank allocation sub-window opened in the flow of entry (transaction type, instrument no., date) |
| R14 | Company creation (3) | `2025/01/1-company-creation-tallyprime.png` | Full-width master form, `Label : value` with colon alignment, two columns, financial year field focused |
| R15 | Ledger master (11) | `2022/01/ledger-alteration.gif` | Ledger Alteration: Under (group), behaviour flags, mailing details panel; totals of opening balances top right |
| R16 | Delete from register (20, 21) | `2020/08/delete-transaction.gif` | Register after a voucher was deleted (Alt+D) — row disappears, selection moves to next |
| R17 | Edit log (20) | `2020/08/edit-log.jpg` | Version history table: Version, Activity, Username, Date & Time |
| R18 | Detailed register (17, 21) | `2020/08/day-book-altf5.gif` | Alt+F5 detailed view: each voucher expands to its ledger lines with Dr/Cr |
| R19 | Cancelled voucher (20) | `2020/08/cancelled-daybook.gif` | Cancelled voucher stays in the register as "(cancelled)" with no amounts |
| R20 | Gateway of Tally (1, 2, 3) | `2020/10/gateway-of-tally.gif` | Top menu (K: Company, Y: Data, Z: Exchange, G: Go To, O: Import, E: Export, M: E-mail, P: Print, F1: Help); left info panel (Current period/date, Name of company, Date of last entry); centre menu box grouped MASTERS/TRANSACTIONS/UTILITIES/REPORTS with highlighted hot letters; right panel F2: Date, F3: Company |
| R21 | Go To (19) | `2020/12/goto.jpg` | Go To: search box over a "List of Reports" with actions (Create Voucher, Create Master, Alter Master, Show More) and saved views |
| R22 | Sales voucher, item invoice + Accept (9, 20) | `2020/09/accounting-voucher-creation.jpg` | Item invoice columns (Quantity, Rate, per, Amount); subtotal; charges; "Accept? Yes or No" box at the bottom right |
| R23 | Sales voucher, accounting invoice (9) | `2026/06/sales-voucher.jpg` | Party A/c name with current balance; Particulars/Rate/Amount; total; narration highlighted |
| R24 | Voucher mode dialog (7, 10) | `2025/10/Journal-voucher-2.png` | Small "Create Voucher" dialog; field opens a "List of Modes" pick list to the right |
| R25 | Voucher type selection (7) | `2020/09/change-voucher-type.jpg` | "Name of Voucher" type-to-filter box + alphabetical list with a "Create" action |
| R26 | F12 small config (5) | `2025/11/F12-configure-1.gif` | Three-line Configuration window; value field highlighted |
| R27 | Confirmation (20) | `2026/06/confirmation.gif` | Centred white box: question + "Yes or No" (Y/N keys) |
| R28 | Print (22) | `2026/05/voucher-printing-screen.gif` | Print dialog over a dimmed voucher; right button panel F5–F10 print options; buttons C: Configure, I: Preview, P: Print |
| R29 | Pick list (11, 12, 21) | `2022/01/chart-of-accounts-group-selection-tally.gif` | "Name of Group" type-ahead box + long scrolling list, "Create" at the top, page indicator "8 ▼" |
| R30 | Print dialog detail (22, 6) | zoom of R28 | Right panel slots keep their positions; unavailable actions are greyed, not removed; F12: Configure always at the bottom |
| R31 | Gateway (newer release) (1, 23) | `2026/10/2-try-now-tile-on-gateway-of-tally.png` | Same Gateway layout; find bar in the top bar ("Alt+F"); F2: Period / F3: Select Company; Dashboard entry added |
| R32 | Export configuration (22, 24) | `2026/05/export-configuration.gif` | "List of Configurations" grouped (Report Details, Header, Company, Export Settings); Show Less; italic values |
| R33 | Bank reconciliation (25, 6) | `2025/09/3-bank-reconciliation-reconciled-transactions-tally.png` | Full workspace: top menu, title bar, right F-key panel (F2 Period, F3 Company, F4 Bank Ledger, F8 Modify Match, F9 Set Status, B: Basis of Values, H: Change View, J: Exception Reports, L: Save View, F: Apply Filter, F12: Configure); bottom bar (Q: Quit, Enter: Alter, Space: Select) |
| R34 | Receivables / outstanding (17) | `2026/10/ledger-outstandings.gif` | Ledger Outstandings: pending bills with ageing columns, Sub Total, On Account |
| R35 | Confirmation after action (20) | `2025/09/Create-receipt-voucher.png` | Result message + follow-up question "Yes or No" |

Categories 1–25 from the brief are each covered by at least one reference. Category 23 (window transitions) can only be inferred from still images, so it is marked [assumption] below.

## 2. Verified observations (seen in the references)

**Layout and proportions.** Every screen has the same frame (R20, R31, R33). A top menu band holds lettered menus. Under it, a thin title bar shows the screen name on the left, the company in the centre and × on the right. The working area takes ~85% of the width. A fixed right-hand button panel (~13% of width) lists the function keys, and some screens add a bottom button bar. Reports and vouchers use the full width; the main content has no rounded cards and no whitespace margins.

**Density and type.** Small sans-serif text (≈11–12 px at 1366 wide), single-line rows with ~15 px pitch (R03, R10). Group rows are bold; child rows are indented, regular or italic (R04, R06). Amounts are right-aligned and bold for totals. Column headers are plain text with thin rules. Headings are letter-spaced ("P a r t i c u l a r s", "G r a n d  T o t a l").

**Colour and states.** Mostly white work surface with light-blue chrome (title bar, menu box, pick lists). One strong highlighter colour marks the selected row or menu item. The field being edited gets a pale fill and a thin border (R02, R11, R14). Disabled options are grey, not hidden (R11, R30).

**Menus.** The Gateway menu is a centred box with uppercase group captions (MASTERS / TRANSACTIONS / UTILITIES / REPORTS). Each item has one highlighted hot letter, which is not always the first letter ("CHart of Accounts", "Day BooK", "BaNking") (R20). Pick lists are a type-to-filter box above an alphabetical list, with a "Create" action at the top (R25, R29).

**Function keys and context.** The right panel changes with the screen. On the Gateway it shows F2 Date/Period and F3 Company (R20). Bank reconciliation shows F2–F12 plus letter actions (R33); Print shows F5–F10 print options (R28). F12: Configure sits at the bottom of the panel (R28, R33). From R01: F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase, Alt+F5/F6 debit/credit note, F10 other vouchers, F11 features, F12 configure, Alt+G Go To, Ctrl+A accept, Esc back/close, Enter drill-down, Space select, Alt+D delete, Alt+X cancel (void), Alt+F5 detailed/condensed, Ctrl+F filter.

**Voucher entry.** A type badge sits at the top left, with No. beside it and the date plus weekday at the top right (R12, R22, R23). The party/account is next, with its current balance shown in small italics. Lines follow (Particulars … Amount, or item columns), then Narration at the bottom left and the total at the bottom right. Saving shows "Accept? Yes or No" (R22). Sub-screens such as bank allocation open in the flow of entry (R13).

**Masters and settings.** These are `Label : Value` forms with aligned colons, grouped under bold section captions, often in two columns (R02, R14, R15, R32). F12 configuration windows are small and use the same `Label : Value` grammar (R11, R26).

**Reports.** Report name, company and period sit in the header block (R03, R07, R09). Totals are pinned at the bottom (Grand Total, Closing Balance) (R03, R09). Detailed/condensed views toggle (R04, R18). Comparison columns can be added (R08). Cancelled vouchers stay visible but marked (R19). The ledger report shows Opening / Current Total / Closing (R09).

**Dialogs.** Confirmations are small centred white boxes with "Yes or No" (R27, R35). Destructive actions remove the row and keep the selection in place (R16).

## 3. Assumptions (not directly verifiable from stills)

- [assumption] Esc steps back one level and keeps the previous screen's selection (consistent with R01's "go back to the previous screen", but motion and state retention aren't visible).
- [assumption] Screen transitions are instant, with no animation.
- [assumption] Hot letters work without a modifier inside menus (implied by the highlighted letters in R20).
- [assumption] Up/Down keys move the selection bar in reports and Enter drills down (R01 text says Enter drills down; the bar is visible in R03–R10).

## 4. VaultBook equivalents (US accounting adaptation)

| Tally pattern | VaultBook equivalent | Adaptation notes |
|---|---|---|
| Gateway of Tally | **Gateway of VaultBook** (`#/gateway`, the new home) | Left: company, fiscal period, today, last entry, basis. Centre: grouped menu MASTERS / TRANSACTIONS / BANKING / REPORTS / COMPANY with hot letters. Existing Dashboard kept as a menu item. |
| Top menu K/Y/Z/G/O/E/P | **Command bar**: Company (Alt+K), Data (Alt+Y: backup/restore/integrity), Go To (Alt+G / Ctrl+K), Import (Alt+O), Export (Alt+E), Print (Alt+P), Help (F1) | Every item opens an existing feature. No e-mail or WhatsApp features (not supported offline). |
| Right button panel | **Function-key panel** (right rail) built from a central registry | Shows only valid actions for the current screen. Every button is clickable and keyboard-reachable. |
| Contra / Payment / Receipt / Journal / Sales / Purchase | F4 Transfer · F5 Expense (pay money out) · F6 Receive Payment · F7 Journal Entry · F8 Invoice · F9 Bill; Alt+F5 Vendor Credit · Alt+F6 Credit Memo · Alt+F8 Sales Receipt · Alt+F9 Pay Bills; F10 all transaction types | US document types from `schema.TXN_TYPES`. No GST/TDS. |
| Accept? Yes/No | Existing explicit Save (Ctrl/⌘+S mnemonic) plus a duplicate-posting guard | VaultBook keeps explicit Save; Ctrl+A stays Select All (text editing). |
| Voucher layout | Entry window: type badge, No., date + weekday on the right; party with current balance; dense line grid; memo bottom-left, total bottom-right | Posting rules unchanged (`ledger.js`). |
| F11 Features | **F11 Company Features window**: two-column `Label : Yes/No` groups over the real feature flags and company settings | Turning a feature off keeps its data (existing behaviour). |
| F12 Configure | **F12 Configuration window**, context-sensitive: appearance and density (all screens), report display options on reports, entry defaults on forms | Only settings that actually take effect. |
| Selection bar + Enter drill-down | Keyboard row cursor on registers and reports: ↑/↓/Home/End/PgUp/PgDn move, Enter opens the row's link | Uses existing drill-down links. |
| Esc = back | Esc returns to the previous screen when no dialog or menu is open and focus is not in a text field. Esc in a field leaves the field first. | Unsaved-changes guard (BUG-002 fix) still applies. |
| Highlighter yellow, blue chrome | **Original palette**: deep teal "vault" chrome, white work surface, warm amber selection bar, slate text | Comparable usability cues (one strong selection colour) with a distinct identity. |

## 5. Implementation priorities

1. Design tokens and frame (command bar, title bar, F-key panel, density) — applies to every screen at once.
2. Gateway with hierarchical menus (arrow / Enter / Esc / hot letters).
3. Central shortcut registry (F1–F12, Alt+G, Esc back, voucher keys) plus the help panel generated from it.
4. F11 Company Features and F12 Configuration windows.
5. Entry windows: type switching F4–F10, date and weekday header, current balance, Esc behaviour.
6. Registers and reports: keyboard row cursor and drill-down, compact tables, title-bar headers.
7. Remaining screens and dialogs inherit tokens; confirm dialogs restyled to the compact Yes/No pattern.

## 6. Implementation result (session 2)
Implemented: frame (command bar, title bars, function-key panel), Gateway with sub-menus, registry-driven keys, F11, F12, entry strip with current balances, row cursor + drill-down + Esc back with remembered row, dense tables, dark mode, phone layout. Compare `reference-ui/before/` with `reference-ui/after/`.
Not done / deviations: no "Accept? Yes/No" on save (explicit Save kept, DEC-010); no bottom button bar (actions live in the right panel); confirmation dialogs keep their existing wording and buttons, restyled only.
Chrome limitation: Claude in Chrome cannot open `file://` pages, so the running app was inspected in Playwright Chromium (same engine) in the cloud workspace rather than in the user's Chrome.
