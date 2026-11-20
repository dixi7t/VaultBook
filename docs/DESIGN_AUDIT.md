# Design audit — Impeccable (1.18.1)

Tool: Impeccable 4.8.0 (`impeccable detect`): source scan, plus rendered scans over CDP of 12 screens
(Gateway, Dashboard, new Invoice, Bill, Journal, Transactions, Customers, Reports, P&L, Settings, Items,
Chart of accounts) on a sample company at 1366×900. Mode: **Operate**. This was a refinement: the
existing VaultBook look and the QuickBooks-style layout were kept.

## Rendered findings, before → after

| Finding | Before | After | Notes |
|---|---:|---:|---|
| Functional text below the 11px floor | 288 | 0 | Table amounts, badges, field labels, headers, QB toolbar, chart ticks |
| Tiny body text (< 12px warning) | 11 | 6 | What's left is 11–11.8px secondary text (hints, muted sub-lines), above the floor |
| Nested cards | 3 | 1 | Left as is: the invoice line-item grid frame (a data table, not a card) |
| Flat type hierarchy | 3 | 3 | Page titles raised 14 → 16px; the detector still compares against the 14px base |
| Monotonous spacing | 1 | 1 | Dense ledger UI on purpose |

Source scan (theme CSS): side-stripe accents 3 → 0; zero-offset glow 1 → 0. The two "low contrast"
hits (`#4fc1b9`, `#8ea4a1`) are dark-theme tokens on a dark surface, so they are false positives. Selection
and scrollbars were already themed.

## Changes

- **Text floor:** every `font-size` below .8rem is now `max(11px, …)`. The same applies to the
  `--fs-caption` token, numeric table cells (`.88em`) and chart ticks. This holds in compact density too.
- **Side stripes removed:** banners, Gateway alerts, report notes, the migration result and
  Designer list selection now use a 1px full border or a tint. The sidebar's active group has no 3px inset
  bar and no glow.
- **Sidebar active state (bug):** Invoices, Bills and Transactions all route to `transactions`, so
  three groups lit up at once. A link with a query now wins over the bare route link (`ui-core.js`).
- **No nested cards:** Dashboard P&L figures are flat and separated by rules. The totals panels on the
  regular and QuickBooks invoice forms lose their inner frame.
- **Dashboard:** the first column is wider (1.3fr), so the "Bank and card accounts" names and balances no longer
  wrap. Card-head links don't wrap, and the inner table frame is gone.
- **Hierarchy:** page title 14 → 16px; top-bar title and page subtitles 12px.

## Scores (critique heuristics, 0–4)

| Area | Before | After |
|---|---:|---:|
| Readability / text floor | 1 | 3 |
| Consistency of accents | 2 | 3 |
| Navigation clarity (active state) | 2 | 4 |
| Visual hierarchy | 2 | 3 |
| Density / layout fit (dashboard) | 2 | 3 |

## Not done (left for the user)

- No PRODUCT.md / DESIGN.md yet: run `/impeccable init`, then `/impeccable document`, to record the system.
- The Transactions filter "Apply" button wraps to its own row at 1366px. It is still usable; left alone.
- The dark theme was not re-screenshotted. The changes only use theme tokens.
