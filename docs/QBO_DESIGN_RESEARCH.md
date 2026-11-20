# QuickBooks Online design research (for VaultBook)

Researched 2026-11-10. Purpose: a working reference for making VaultBook *work like* QuickBooks Online
(QBO) for people who move from it, while keeping VaultBook's own look, name and keyboard model.
QBO changes often; every finding below names its source (list at the end) and should be re-checked
before a release that depends on it.

---

## 1. What changed in QBO, and when

| When | Change |
|---|---|
| Aug–Sep 2025 | New interface in early access; opt in or back out from the gear menu. |
| Oct 2025 | New bank feed became the default for all users. |
| Nov 2025 | New interface starts rolling out to everyone ("Intuit Platform"). |
| 2025–2026 | New invoice and estimate layout (Plus/Advanced could switch back for a while). |
| May 2026 | Refreshed experience becomes the default interface. |
| May–Jun 2026 | Classic report view removed; Modern view is the only report view. |
| Dec 31 2026 | QuickBooks Online Accountant discontinued, replaced by Intuit Accountant Suite. |

So "QuickBooks style" for a client arriving in 2026–2027 means the **new** interface below, not the
older black left menu many tutorials still show.

---

## 2. Navigation (left rail + header)

**Left rail (narrow, icons with labels):**
- **+ Create**: hover or click shows every form: invoice, expense, bill, check, deposit, journal
  entry, plus new customer, vendor, employee, project, task.
- **Bookmarks**: hover shows bookmarked pages; "+ Bookmark current page"; Edit to drag and reorder.
- **Dashboard** (home), **Feed** (business feed), **Reports** (hover: Standard, Custom, Financial planning).
- **My apps**: hover shows the app groups (Accounting, Expenses & Pay bills, Sales & Get paid,
  Customers, Team, Sales tax, Business tax…); hover an app to see its pages.
- **Pinned apps**: up to three apps pinned under the rail; **Customize** at the bottom reorders them.
- Banking moved: it now lives under **Accounting** (Bank transactions).

**Header:** one search box "Search, jump to, or ask a question" (unified results: transactions,
customers, accounts, reports, help); integrations (plug icon); contact experts; the **gear menu**.

**Gear menu:** Settings, Lists, Tools, Your Company columns (unchanged for years), What's new,
Feedback, keyboard shortcuts under Additional info. The Business view / Accountant view switch is
at its bottom.

**What users complain about:** sub-menus that slide over the main menu and hide it; hover menus
that collapse as the mouse moves; things moved without warning. Intuit's own advice is "pin
bookmarks so the menu stays steady."

---

## 3. Home page

From top to bottom:
1. Greeting ("Good evening, David!") and the **app carousel** (the same apps as My apps).
2. **Create actions**: shortcut buttons for common work; up to 10; user picks them with "Show all",
   otherwise QBO picks them as it learns the business.
3. **Business feed**: a prioritised list of things needing attention and work done by its AI
   agents (overdue invoices to chase, bank lines to review, a fixed asset it spotted); "View all"
   opens a Needs attention page.
4. **Business at a glance**: widgets (bank balances, invoices, expenses, profit and loss, sales,
   cash flow). **Customize → Add or remove widgets**; drag to move; drag edges to resize.
5. A **Privacy** toggle hides every amount while the page is visible.

Users hated the first version of the new dashboard (Dec 2025 thread); resizable widgets and
widget choice were Intuit's response.

---

## 4. Banking (Bank transactions)

- Tabs renamed in the new design: **For review → Pending**, **Categorized → Posted** (plus Excluded).
- Account cards across the top can be hidden or shown.
- AI suggestions for category and payee, and **match suggestions that no longer need a near-exact
  amount match**; related transactions linked together (paired transfers).
- Comments on a bank line; requests for information from the client (higher plans).
- Upload a statement as PDF/JPG/PNG; it is read into the feed for confirmation.
- Edit the date of a bank line; simpler batch actions; create a sales receipt straight from a
  money-in line; Product/Service column when items are used.
- Complaints: "harder to read", "horrible to navigate", wrong vendor predictions with no obvious
  way to change them; many asked for the old page back.

**For VaultBook:** our tabs should follow the new names (Pending / Posted / Excluded) or keep
"For review / Posted"; "Categorized" (1.25.0) is the *old* QBO word. See backlog item B1.

---

## 5. Forms (invoice, estimate)

- One layout for invoices and estimates; options are **on the form itself** ("no need to manage
  templates"): a right-hand panel shows, hides or renames columns and changes colours and fonts,
  and QBO remembers the choices for the next form.
- Email and PDF preview of the form; customers approve estimates online; estimate status and
  "convert to invoice" in the Customer Hub.
- Late fees calculated on the invoice.
- Missing compared with classic (per Intuit and users): adding a new term from the form, adding
  previous attachments, the full layout designer, memorised templates, some print formatting,
  a service-date field. Simple Start / Essentials could not go back to the old layout.

**For VaultBook:** keep our invoice designer and keyboard entry (a real advantage); borrow the
"customize on the form" panel and the live preview.

---

## 6. Reports

- **Modern view only** (Classic removed May–June 2026).
- Slim top panel with the most used choices: dates, **Display columns by**, **Compare to**,
  accounting method. Everything else (filters, grouping, pivots, columns) in **one Customize
  panel on the right**.
- Columns: add, remove, reorder by drag; widths persist.
- A **chart** switch on each report; chart type can be changed.
- Visual options: banded rows, colour-coded columns, gridlines (some only on Advanced).
- Save as a custom report; scheduled email.
- Complaints: Modern view "a downgrade", no way to make Classic the default, saved settings not
  sticking.

**For VaultBook:** our registers (1.25.1) already use the right-hand options panel and a chart.
Apply the same shell to every report, and keep a "classic" layout option QBO took away.

---

## 7. Customers (Customer Hub)

- Customer Hub: Overview, **Customers & leads**, light CRM (notes, estimates, invoices,
  communication history, follow-ups).
- A customer page has tabs **Transactions, Statements, Customer Details** (and a recurring tab);
  "New customer" opens a panel that slides in from the right.
- Complaint: tabs users relied on (a Deposits tab) disappeared.

---

## 8. Keyboard

QBO's keys are Ctrl+Alt combinations (Mac: Ctrl+Option), list with **Ctrl+Alt+?**:

| Ctrl+Alt + | Opens / does |
|---|---|
| I | Invoice |
| W | Check |
| X | Expense |
| E | Estimate |
| R | Receive payment |
| C | Customers |
| V | Vendors |
| A | Chart of accounts |
| L | Lists |
| F | Search transactions |
| H | Help |
| On a form: S / D / M / P / X or C | Save and new / Save and close / Save and send / Print / Close |

Date fields: + and − change the day; Alt+↓ opens the calendar; Tab / Shift+Tab move between fields.
The QBO desktop app adds Alt+H (home), Alt+C, Alt+V, Alt+B (banking), Alt+S (sales), Alt+X
(expenses), Alt+A, Alt+P, Alt+R, Ctrl+W (close window).

**For VaultBook:** keep the Tally F-keys and add the Ctrl+Alt set as aliases, so a QBO user's hands
work on day one (backlog A3).

---

## 9. Visual design (what NOT to copy)

- Font: **Avenir Next for Intuit**, a licensed brand face. Not available to us; VaultBook stays on
  the system UI font.
- Colours: QuickBooks green for the logo; a third-party write-up of Intuit's tokens names "Super
  Blue" (#236CFF) as the action colour. VaultBook keeps teal and yellow.
- Layout grid: everything on a 4-pixel grid (Intuit's own rule); a good, generic practice we can
  adopt (our spacing already uses 4/8/12/16).
- Logo, name, icons, illustrations, wording such as "Intuit Assist", "Business at a glance" as a
  product term: **not used**. We name our own things (Business overview, Tasks…).

Legal line: layout patterns (a left menu, a Create button, bookmarks, a customize panel) are
functional and widely shared; brand assets and a near-indistinguishable copy are not. Keep
VaultBook recognisably VaultBook.

---

## 10. Gap list: VaultBook 1.25.1 against QBO 2026

| Area | QBO | VaultBook now | Gap |
|---|---|---|---|
| Create | + Create in rail | + New in top bar, F10, grouped menu with keys | Same idea; done |
| Bookmarks | Bookmarks menu, add current page, reorder | none | **Missing** |
| Apps menu | My apps hover menu, 3 pinned apps, Customize | full grouped sidebar with flyouts | Partly |
| Search | One box: jump to pages, records, help | Ctrl+K palette (pages, records, actions) | Done (ours is keyboard-first) |
| Gear menu | Settings / Lists / Tools / Your Company | Settings page, F11/F12, K:Company menu | Missing as one menu |
| Home | Create actions, feed, widgets you choose, move, resize, privacy | Shortcuts, fixed widgets, Tasks | Widget choice, privacy toggle |
| Banking | Pending / Posted / Excluded, comments, edit date | For review / Categorized / Excluded, rules, match, split | Rename; comments |
| Forms | On-form customize panel, preview | Desktop-style forms, separate designer | Customize panel, preview |
| Reports | Slim top + right Customize + chart | QBD-style toolbar; registers already new style | **Main gap** |
| Customers | Hub with tabs, side panel for new | Contact page | Tabs and summary |
| Keys | Ctrl+Alt set | Tally F-keys, Ctrl+K | Add aliases |

---

## 11. Backlog, in order

**A. Navigation**
1. Bookmarks: "Bookmark this page" (Ctrl+D), a Bookmarks menu in the side menu, edit and reorder.
2. Gear menu in the top bar: Settings, Lists, Tools, Your company, shortcuts.
3. Ctrl+Alt keys as aliases for QBO users; shown in the F1 list.
4. Optional compact side menu (icons only) with hover menus that open *beside* it, never over it.

**B. Banking**
1. Tab names: For review / Posted / Excluded (undo 1.25.0's "Categorized"), or Pending / Posted.
2. A comment on a bank line; edit a bank line's date before posting.

**C. Reports**
1. One report shell for every report: slim top bar (dates, columns by, compare to, cash/accrual),
   Customize panel on the right (filters, group by, columns), chart switch, save.
2. Keep a "Classic layout" option.

**D. Home**
1. Customize: choose and order widgets; a privacy switch that hides amounts.

**E. Forms and customers**
1. On-form customize panel and live email/PDF preview (keep the designer and keys).
2. Customer and vendor hubs: summary on top, tabs Transactions / Statements / Details / Notes.

---

## Sources

- How to use QuickBooks Online (New 2026 Interface) — https://apple-goldfish-5fa2.squarespace.com/blog/how-to-use-quickbooks-online-new-interface
- Understand the navigation menu in QuickBooks on the Intuit Platform (Intuit) — https://quickbooks.intuit.com/learn-support/en-uk/help-article/bookkeeping-processes/understand-navigation-menu-quickbooks-intuit/L310NeoHY_GB_en_GB
- The Navigation Bar in QuickBooks Online (TeachUcomp) — https://www.teachucomp.com/the-navigation-bar-in-quickbooks-online-instructions/
- Accountants Toolkit FY25 (Intuit PDF) — https://digitalasset.intuit.com/render/content/dam/intuit/sbsegcs/en_us/quickbooks-online-accountant/documents/Accountants-Toolkit-FY25.pdf
- QBOA vs Intuit Accountant Suite (AccountingWEB / Intuit) — https://www.accountingweb.co.uk/node/230481
- Customize your Home page in QuickBooks Online (Intuit) — https://quickbooks.intuit.com/learn-support/en-us/help-article/product-setup/customize-home-page-quickbooks-online/L0ryPsyjD_US_en_US
- New dashboard thread, Dec 2025 (Intuit Community) — https://quickbooks.intuit.com/community/do-more-with-quickbooks-6/new-dashboard-everyone-hates-it-right-december-2025-284013
- A new default for QuickBooks (Intuit) — https://quickbooks.intuit.com/global/resources/product-update/quickbooks-new-experience-defaults/
- Explore the new QuickBooks (Intuit Canada) — https://quickbooks.intuit.com/ca/resources/product-update/explore-the-new-quickbooks/
- Learn about updates to the new AI-powered banking page (Intuit) — https://quickbooks.intuit.com/learn-support/en-au/help-articles/review-and-update-bank-transactions/00/378028
- How AI suggestions help match and categorize bank transactions (Intuit) — https://quickbooks.intuit.com/learn-support/en-ca/help-article/bank-transactions/ai-suggestions-help-match-categorize-bank/L8FHOh4AD_CA_en_CA
- QuickBooks Online's New Bank Feed (Porte Brown) — https://www.portebrown.com/newsblog-archive/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025
- New Banking Page – Not Good (Intuit Community) — https://quickbooks.intuit.com/community/banking-4/new-banking-page-not-good-24079
- See what's new with estimates and invoices (Intuit) — https://quickbooks.intuit.com/learn-support/en-ca/help-article/invoicing/see-whats-new-estimates-invoices-quickbooks-online/L7n6BnSYx_CA_en_CA
- Transition from Classic to Modern view reports (Intuit) — https://quickbooks.intuit.com/learn-support/en-za/help-article/business-reports/transition-classic-modern-view-reports/L9hzVlzh4_ZA_en_ZA
- Customize your reports using the new Modern view (Intuit) — https://quickbooks.intuit.com/learn-support/en-ca/help-article/business-reports/customize-reports-using-new-modern-view/L2ta2XZDQ_CA_en_CA
- Preparing your reports for the future with Modern view (Intuit) — https://quickbooks.intuit.com/ph/resources/product-update/preparing-your-reports-for-the-future-with-modern-view/
- Who Are Your Customers? (Porte Brown) — https://blog.portebrown.com/who-are-your-customers-quickbooks-online-can-tell-you
- Customer Hub (SVA) — https://accountants.sva.com/biz-tips/quickbooks-online-whats-new-bill-pay-and-customer-hub
- 17 keyboard shortcuts for QuickBooks Online (Dummies) — https://www.dummies.com/software/business-software/quickbooks/quickbooks-online-for-dummies-uk-edition-cheat-sheet/
- QuickBooks Online Desktop App keyboard shortcuts (Intuit PDF) — https://assetlibrary.intuit.com/content/dam/km/external/salesforce/2000s/2200-2399/2359_01.pdf
- Mastering QuickBooks: keyboard shortcuts (Packt) — https://www.packtpub.com/en-tr/product/mastering-quickbooks-2024-fifth-edition-23-9781835469958/chapter/shortcuts-and-test-drive
- QuickBooks typography (Intuit design) — https://design.intuit.com/quickbooks/brand/design-foundations/type
- Intuit design system summary (shadcn.io, third party) — https://www.shadcn.io/design/intuit/raw
- How do we go back to the old sidebar (Intuit Community) — https://quickbooks.intuit.com/community/other-questions-9/how-do-we-go-back-to-the-old-sidebar-80740
- Trade dress and the functional look and feel of software (evan.law via Harvard TagTeam) — https://tagteam.harvard.edu/hub_feeds/3624/feed_items/5435107/content
