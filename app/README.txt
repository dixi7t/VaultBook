OfflineBooks US 1.6.0
=====================
Double-entry bookkeeping for US small businesses that runs entirely on your
Windows 11 PC. No installation, no internet, no account, no subscription.


START IN 4 STEPS
----------------
1. Right-click OfflineBooks_US_Windows11.zip and choose "Extract All...".
   Pick any folder, for example Documents\OfflineBooks_US.
2. Open the extracted folder.
3. Double-click index.html.
4. If Windows asks which app to use, choose Google Chrome or Microsoft Edge.

Then create your company on the first screen (tick "Add sample data to explore"
if you want a practice company first) and start bookkeeping.

Tip: bookmark the page in your browser so you can reopen it with one click.


REQUIREMENTS
------------
- Windows 11 (Windows 10 also works).
- Google Chrome or Microsoft Edge, current version.
- Use a NORMAL browser window. InPrivate / Incognito windows erase data when closed.
- Nothing else. There is no Python, Node.js, database server, or internet use.


COMPANY SNAPSHOT: sidebar -> Company Snapshot. Your business at a glance in
movable, configurable panels. See USER_GUIDE.txt section 16.

FIND ANYTHING: press Ctrl+K (or click Search in the sidebar) and type a
transaction number, a name, an amount, a report, or what you want to do
("new invoice", "reconcile", "dark mode").

QUICKBOOKS DESKTOP: Transactions -> QuickBooks .iif exports the invoices you
tick as an .iif file for File -> Utilities -> Import -> IIF Files in
QuickBooks Desktop. See USER_GUIDE.txt (Printing invoices).

A WHOLE COMPANY FROM QUICKBOOKS: on the company screen choose "Create from
QuickBooks files" (Alt+Q) and pick everything the client sent: from QuickBooks
Online the Journal, Trial Balance, Balance Sheet, Profit and Loss and contact
lists (Excel); from QuickBooks Desktop the IIF lists and General Ledger. The
company is created, previewed, imported, then checked against QuickBooks' own
balances. See USER_GUIDE.txt (Bring a whole company in from QuickBooks).

THE SCREEN: the top bar has search (Ctrl+K), the current period (Alt+F2) and
+ New (F10). Home has two tabs: Get things done (the Gateway, G H) and
Business overview (G D) with your numbers at a glance.

KEYBOARD LIKE TALLYPRIME: F2 changes the current date, Alt+F2 the current
period (type dates as june20, 0620 or 6/20). Gateway > Registers has the Sales
Register, Purchase Register and Cash/Bank Book; Gateway > Reclassify
transactions moves lines to the right account or class. See USER_GUIDE.txt.

APPEARANCE: the sun/moon button in the top bar switches Light and Dark.
Settings and backup -> App and storage also offers "Match Windows" and
Compact/Comfortable density. These display preferences, the sidebar state and
table column layouts are remembered in this browser across restarts.

WHERE YOUR DATA IS STORED  (please read)
----------------------------------------
Your books are saved inside the browser's private storage (IndexedDB) on this PC,
for the current Windows user and browser profile. That means:

- Data is NOT stored in the extracted folder. Moving or deleting the folder does
  not delete your books, and copying the folder does not copy your books.
- Chrome and Edge keep SEPARATE data. Always open the app in the same browser.
- "Clear browsing data" with "Cookies and other site data" selected can erase it.
- To move books to another PC or browser: Settings and backup -> Backup and
  restore -> Download backup, then Restore on the other side.

PASSWORD PROTECTION (optional, per company)
Settings and backup -> Security. When on, the company's data is encrypted on
this PC and in its backup files, and the company opens only with its password.
SAVE THE RECOVERY KEY you are given: without the password or the recovery key,
nobody can recover the data. See USER_GUIDE.txt section 12.

DOWNLOAD A BACKUP REGULARLY and keep copies on a USB drive or another computer.
The dashboard reminds you when the last backup is more than 7 days old.


WHAT'S IN THE FOLDER
--------------------
index.html          The application. Double-click to open.
css\app.css         Styles.
js\                 Application code (plain JavaScript, no external libraries):
  prefs.js           display preferences (theme, density, sidebar, table layouts)
  util.js            money in cents, dates, CSV, hashing
  crypto.js          company password: encryption (browser built-in WebCrypto)
  schema.js          account types, default chart of accounts, data migrations
  ledger.js          double-entry accounting engine and validation
  reports.js         financial report calculations
  db.js              IndexedDB storage, one database per company
  backup.js          backup and validated restore
  importer.js        bank/contacts/accounts CSV import
  registers.js       Sales/Purchase registers and Bank Book (1.22)
  hints.js           bank feed extra help: other clients, common merchants (1.45)
  merchants.js       common US merchant names by kind of expense (1.45.1)
  close.js           Close the books: prepare, review, checklist, sign-off (1.46)
  qbupdate.js        Update QuickBooks to match VaultBook: edits, voids (1.47)
  paste.js           Paste entries: rows from Excel to transactions (1.48)
  ui-paste.js        Paste entries page: grid, repeat monthly, post (1.48)
  doccenter.js       Doc Center: inbox, reading, matching, missing, clean up, package (1.49)
  ui-docs.js         Doc Center page (1.49)
  calendar.js        Calendar: events, deadlines, cash forecast, .ics (1.50)
  ui-calendar.js     Calendar page: month, week, agenda, reminders (1.50)
  ui-menubar.js      Menu bar (File ... Help) and icon toolbar (1.51)
  reclass.js         Reclassify Transactions engine (1.22)
  statements.js      statement builder (P&L, balance sheet, budget vs actual), reconciliation
  xlsx.js            Excel (.xlsx) writer: styles, formulas, frozen panes, print setup
  pdf.js             PDF writer for reports (standard fonts, made offline)
  report-model.js    one report model for screen text, Excel and PDF
  designer.js        statement designer: report templates, formulas, account mapping
  workbook.js        Export financial workbook: linked, formula-driven Excel workbook
  sample.js          optional sample company
  ui-combo.js        type-to-search account/customer/vendor fields
  ui-security.js     unlock screen, lock / auto-lock, Security settings
  ui-palette.js      command bar (Ctrl+K): search everything, run any action
  ui-tables.js       resizable columns, column visibility, sticky key columns
  ui-charts.js       small accessible SVG chart kit (bars, donut, ranked bars)
  ui-snapshot.js     Company Snapshot: Company / Payments / Customer tabs
  ui-nav.js          bookmarks (Ctrl+D), gear menu, compact side menu (1.26)
  find.js            Find engine: conditions, plain-word search, search everything (1.27)
  recon-report.js    reconciliation report model: Detail and Summary (1.27.2)
  qbsend.js          Send to QuickBooks Desktop: list, batch v2, result (1.30)
  qbsync.js          QuickBooks snapshot matching: months, gap, remember (1.31)
  qbfull.js          QuickBooks connector full export -> import model, tie-out (1.32)
  ui-qbd.js          QuickBooks Desktop section: overview, tie-out report (1.32)
  paystub.js         Paystubs -> payroll journal entry: parse, prove, employer taxes (1.33)
  ui-payroll.js      Payroll section: drop paystubs, review, post, settings (1.33)
  paydocs.js         Payroll documents: recognise, read, cross-check (1.34)
  tools/paystub-iif  Standalone Paystub to QuickBooks IIF page; build.py makes one offline file (1.33.1)
  paydays.js         Invoice Payment Days report: days to pay, averages by customer (1.29)
  ui-find.js         Find screen: All results / Simple / Advanced, Ctrl+F (1.27)
  ui-*.js            screens
tests\tests.html    Self-test: open it in Chrome/Edge to run 30 checks in your
                    browser. Uses temporary test data; your books are untouched.
tests\engine.tests.js   The test cases.
tests\run-node.js       Developer-only runner for Node.js (not needed by users).
tests\dev\e2e_playwright.py  Developer-only end-to-end UI test (not needed by users).
tests\dev\designer_ui.py    Developer-only test of the statement designer, PDF and Excel exports.
tests\dev\workbook_ui.py    Developer-only test of Export financial workbook.
tests\dev\workbook_check.py Developer-only check: recalculates exported workbooks in LibreOffice.
tests\dev\lo_recalc.py      Helper: real LibreOffice recalculation (UNO) of .xlsx files.
tests\dev\a11y_audit.py      Developer-only accessibility/responsive audit (axe-core).
tests\dev\qbo26_ui.py        Developer-only test of the 1.26 QuickBooks Online patterns.
tests\dev\find_ui.py         Developer-only test of Find (1.27).
tests\dev\mis_ui.py          Developer-only test of Invoice Payment Days (1.29).
tests\dev\qbsend_ui.py       Developer-only test of Send to QuickBooks Desktop (1.30).
tests\dev\qbd_ui.py          Developer-only test of the QuickBooks Desktop section (1.32).
tools\VaultBook QuickBooks.cmd    Windows: Read QuickBooks (snapshot), Send VaultBook invoices and
                    payments (applied to their invoices), Export everything (1.32). One menu; asks
                    for files, never searches. Runs VaultBook-QB.ps1; see USER_GUIDE.
docs\SCHEMA.txt     Database layout and migration notes.
README.txt          This file.
USER_GUIDE.txt      How to do your bookkeeping, backups and restores.
CHANGELOG.txt       Version history, test results and known limitations.


TROUBLESHOOTING
---------------
"Local storage could not be opened"
    You are probably in an InPrivate/Incognito window, or the browser blocks
    site data. Open a normal window. In Chrome: Settings -> Privacy and security
    -> Third-party cookies/Site data must not be set to block all site data.

My company disappeared
    Check you're using the same browser and Windows user as before. If browser
    data was cleared, restore your latest backup file from the first screen.

The page looks unstyled or blank
    Make sure you extracted the ZIP (don't run index.html from inside the ZIP
    preview) and that the css and js folders sit next to index.html.

I forgot the company password
    On the unlock screen choose "Forgot password? Use recovery key" and enter
    the 32-character recovery key. You will set a new password. Without the
    recovery key the data cannot be opened; restore an older backup made
    before protection was turned on, if you have one.

Downloads (backups, exports) don't appear
    Check your browser's Downloads list (Ctrl+J). Files go to your Downloads folder.
