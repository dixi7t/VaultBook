# VaultBook — Audit and Baseline (Phase 0)

> Product: **VaultBook** (formerly OfflineBooks US; see DEC-006). Source audited: `app 2.zip` → `app/`, app version 1.7.0.
> Audit date: 2026-10-22. Evidence below comes from reading the source and running the commands shown. Nothing here is assumed.

## 1. Repository and entry points (AUD-001)

| Item | Finding |
|---|---|
| Repo layout | `app/` = the shipped application. `AGENTS.md`, `docs/` = project governance (added this session). |
| Version control | None in the received zip. Git repo created this session at repo root; baseline commit `2c6b3ad` is the zip unmodified. |
| Entry point | `app/index.html` — static page, 32 classic `<script>` tags (no modules, no bundler), boot = `OB.ui.start(); OB.windows.init();` |
| Launch method | Open `app/index.html` directly in Chrome/Edge (`file://`). No server, no build. **Verified**: the e2e suite drives the app over `file://` in Chromium. |
| Runtime deps | None external. CSP: `connect-src 'self' blob: data:` — no network. Vendor libs bundled in `app/js/vendor/` (pdf.js, Tesseract OCR + English data, SheetJS, statement-engine). Fonts bundled in `app/css/fonts/`. |
| Version strings | `schema.js` `APP_VERSION = '1.7.0'`, `DATA_VERSION = 3`; `db.js` `COMPANY_DB_VERSION = 3`, `REGISTRY_VERSION = 1`. |

### Module map (`app/js/`)
| Layer | Files |
|---|---|
| Core (no DOM; also loaded by Node tests) | `util.js` (cents, dates, CSV, hashing), `schema.js` (account types, TXN_TYPES, default COA, data migrations), `crypto.js` (WebCrypto AES-GCM/PBKDF2), `ledger.js` (double-entry engine `Book`, validation, posting, void/reverse, reconciliation, recurring, features), `reports.js` (classic reports), `statements.js` (P&L/BS/BvA statement engine), `backup.js` (backup/restore, checksum, encrypted backup), `xlsx.js`, `importer.js` (CSV import, rules), `sample.js` |
| Storage | `db.js` (IndexedDB adapter, per-company DB), `prefs.js` (display prefs in localStorage) |
| UI | `ui-core.js` (router, modal/drawer/confirm/prompt, unsaved-changes guard, Alt+N), `ui-pages.js` (companies, dashboard, accounts, register, contacts, statement, transactions), `ui-forms.js` (all transaction entry forms, void/reverse/recurring/print), `ui-banking.js` (CSV import, rules, reconcile, recurring), `ui-statement.js` (PDF statement import), `ui-reports.js` (report center + classic reports), `ui-statements.js` (P&L/BS/BvA workspace), `ui-planning.js` (classes, budgets, 1099), `ui-builder.js` (custom report builder), `ui-snapshot.js` + `ui-charts.js` (Company Snapshot), `ui-settings.js`, `ui-security.js`, `ui-palette.js` (Ctrl+K), `ui-shortcuts.js` (? panel, G-sequences), `ui-hotkeys.js` (Ctrl/⌘+letter mnemonics), `ui-combo.js` (type-to-search fields), `ui-tables.js` (resizable/hideable columns), `ui-windows.js` (MDI tabs + taskbar), `ui-flyout.js` (hover flyout sidebar) |

UI/accounting separation is already good: all posting rules live in `ledger.js`; UI calls `Book` methods.

## 2. Architecture and data storage (AUD-002)

- **Registry DB** `OfflineBooksUS` (v1): `companies`, `settings` (`lastCompany`).
- **Company DB** `OfflineBooksUS_<companyId>` (v3): `company, accounts, contacts, transactions (idx date,type), rules, recurring, reconciliations, audit (append-only), meta` (v2) and `classes, budgets, reports` (v3). Upgrades in `db.js COMPANY_UPGRADES`.
- **Data migrations** `schema.MIGRATIONS` 1→2, 2→3; applied on open and on restore; newer data refused.
- **Money**: integer cents; split > 0 debit, < 0 credit; splits rebuilt from source fields, must sum to 0.
- **Transaction types (14)**: invoice, salesReceipt, payment, creditMemo, customerRefund, bill, billPayment, vendorCredit, expense, check, ccCredit, deposit, transfer, journal.
- **Features** (`Book.feature`): `classes`, `budgets`, `1099` — toggled in Settings → Features; data kept when off.
- **Security**: optional per-company password; AES-GCM-256 per record (AAD = store/id), PBKDF2 600k (password) / 100k (recovery key); auto-lock; encrypted backups.
- **Backup**: JSON with checksum (crc32+fnv+len), validated restore, tamper detection.
- **Preferences**: `localStorage` `OfflineBooksUS.prefs.v1` (theme, density, sidebar, table layouts), `OfflineBooksUS.windows.v1` (open windows).
- **Storage identifiers must not be renamed** for VaultBook (would orphan existing books) — see DEC-006.

## 3. Test baseline (AUD-003)

| Suite | Command (from repo root) | Result |
|---|---|---|
| Engine unit tests (Node 22) | `node app/tests/run-node.js` | **39 passed, 0 failed** (≈3 s) — before and after this session's change |
| Browser self-test | open `app/tests/tests.html` in Chrome | Same test file as Node runner; not separately run this session |
| End-to-end (Playwright, Chromium, file://, includes browser restart) | `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"` | As received: **crashed** after 64 checks (test steps stale vs 1.7.0 UI). After harness fixes: **186 passed, 0–1 failed** (flaky, see BUG-001). After BUG-002 fix + 4 new checks: **190 passed** (1 of 3 runs), **189 passed / 1 flaky** (2 of 3 runs). |
| Accessibility (axe-core 4.10.2) | `npm i axe-core` then `AXE_JS=node_modules/axe-core/axe.min.js python3 app/tests/dev/a11y_audit.py "$PWD/app/index.html"` | **8 issue types** (2 rules × 4 configs), 0 JS errors — see A11Y-001/002 |

### E2E harness changes (test-only, no app behavior change)
1. Statement reports keep Excel/CSV in the Export menu (1.7.0) → `export_click()` helper opens it first.
2. Grouped sidebar links live in hover flyouts (1.7.0) → `nav_click()` hovers the group first (moves the pointer off first, because `mouseenter` doesn't re-fire if the pointer is already resting there).
3. Dark-mode check compared against a hard-coded old color (`#0e1413`, `app.css`); `theme.css` overrides it to `#0a0e17` → check now compares body background to the live `--bg` token and asserts it is dark.

## 4. Findings / defects (baseline)

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| BUG-002 | **High (data-entry loss)** | Clicking a window tab, closing the active tab, Close others/Close all, Ctrl+Tab or New tab while a form had unsaved entries **silently discarded them** — `ui-windows.js` set `UI._allowNav = true`, bypassing `UI.confirmLeave`. | Probe: typed expense $77.77, clicked Dashboard tab → hash changed, no dialog, `dirty=false`. New e2e check failed on baseline code. | **PASS** (fixed this session) |
| BUG-001 | Low | GL report: `#main` sometimes scrolls 2–6 px besides the report region (double scrollbar). Flaky: failed in ~half the runs, before and after this session's change. | e2e "Report scrolls in its own region…" `{'main': 6}` | NOT STARTED |
| BUG-003 | Low | Flyout nav: after navigating with the pointer resting on a group, hovering it doesn't reopen the flyout until the pointer leaves. Keyboard access to flyout links not yet verified. | Probe script | NOT STARTED |
| BUG-004 | Medium (misleading UI) | Ctrl/⌘+W, Ctrl/⌘+T, Ctrl+Tab are advertised (tab tooltip "Close (Ctrl+W)", file header) but Chrome/Edge reserve them in a normal tab — they close/open **browser** tabs. `ui-hotkeys.js` itself lists them as unusable. | Source; browser behavior | NOT STARTED |
| BUG-005 | Low | Mnemonic reserved set lacks `y` (Ctrl+Y = redo on Windows) and `d`/`l`/`j`/`o`/`u`/`g`/`p`/`s`/`e` override browser shortcuts (intentional for p/s/e). Could steal Redo in a text field. | `ui-hotkeys.js RESERVED` | NOT STARTED |
| A11Y-001 | Serious (axe critical) | `#window-tabs` has role requiring children (tablist) but contains plain buttons (close buttons, new-tab). | axe `aria-required-children`, 25 pages × 4 configs | NOT STARTED |
| A11Y-002 | Serious | Contrast: white on `#0284c7` = 4.09:1 (New button), white on `#38bdf8` = 2.14:1 (phone dashboard New), tab titles `#475569` on dark. | axe `color-contrast` | NOT STARTED |
| DOC-001 | Low | `app/docs/SCHEMA.txt` says DB v2 / data v2 (code: v3, adds classes/budgets/reports). `README.txt` says 1.6.0 and "30 checks" (code 1.7.0, 39 checks). | Source | NOT STARTED |
| — | Info | No F1–F12 handling exists anywhere. No navigation stack beyond browser history. No Gateway screen (dashboard + sidebar instead). | grep | — |

## 5. Existing keyboard shortcuts (FOUND-004)

| Shortcut | Where | Behavior | Typing-safe? | Notes / conflicts |
|---|---|---|---|---|
| Ctrl/⌘+K | `ui-palette.js` | Toggle command bar | Fires in fields too | Chrome: Ctrl+K = search in address bar on some setups; app intercepts (works). Spec allows. |
| Alt+N | `ui-core.js` | "Create" menu | Fires in fields | macOS Option+N types "˜" dead key — Alt+N on Mac produces `e.key='˜'`, so likely **doesn't work on Mac** (needs verification). |
| Ctrl/⌘+\\ | `ui-core.js` | Toggle sidebar | Fires in fields | OK |
| Ctrl/⌘+letter (mnemonics) | `ui-hotkeys.js` | Press the button with that underlined letter, per layer | Fires in fields (commits field first) | Reserved: a c v x z n t w q h m r f k. Not reserved: y (redo), d, l, j, o, u, g, p, s, e, b, i. |
| ? | `ui-shortcuts.js` | Shortcut panel | Ignored while typing | |
| G then key | `ui-shortcuts.js` | Go-to (18 destinations) | Ignored while typing | |
| Esc | modal/drawer/menus/palette/statement focus | Close | — | Multiple independent document listeners; ordering by registration. |
| Ctrl+Tab / Ctrl+W / Ctrl+T | `ui-windows.js` | Cycle/close/new window | — | Browser-reserved (BUG-004). |
| Arrow/Enter/Tab/Esc in combos | `ui-combo.js` | Type-to-search pick | — | Enter advances focus when list closed. |
| Arrow keys in menus | `ui-forms.js`, `ui-settings.js` | Menu/radio navigation | — | |
| Enter in register/transaction/audit search | `ui-pages.js`, `ui-settings.js` | Apply filter | — | |

Proposed F-key plan (spec §5) has **no existing conflicts in app code**. Platform risks to verify before FOUND-005: macOS uses F1–F12 for media keys unless Fn is held; F5 = reload, F11 = browser full screen, F12 = DevTools, F3 = find next, F6 = address bar, F7 = caret browsing (Chrome/Edge), F10 = menu bar (Windows). `preventDefault` works for most in a page but F11/F12 behavior varies; keep visible alternatives for every F-key action.
