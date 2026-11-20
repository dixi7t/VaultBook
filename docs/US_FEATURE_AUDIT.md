# VaultBook — US accounting feature audit and status (after 1.18.0)

The audit of 2026-11-05 compared VaultBook with what US small-business accounting software is expected to have (QuickBooks Desktop as the benchmark). The user chose which items to build:
- **Skip:** time tracking and mileage, multiple users and roles, early-payment discounts, payroll, and the low-priority list (bank feeds, emailing from the app, multi-currency, consolidation, NACHA / positive pay, loan amortization).
- **Build:** everything else.

| Feature | Version | Status | Where |
|---|---|---|---|
| Make Deposits (group Undeposited Funds) | 1.14 | PASS | Banking → Make deposits |
| Check printing (print later, voucher checks, numbering, alignment) | 1.14 | PASS (real check stock: NEEDS VERIFICATION) | Banking → Print checks |
| 1099: W-9 flag, Copy B recipient statements, 1096 totals, IRIS data CSV | 1.14 | PASS (IRS accepts only its own IRIS template — the CSV is copied into it) | Lists → 1099 setup |
| Bad debt write-off | 1.14 | PASS | Invoice → More |
| Finance charges | 1.14 | PASS | Sales → Assess finance charges |
| Inventory: quantity on hand, average cost, automatic COGS, adjustments, opening quantity, reorder points | 1.15 | PASS | Products and services; Adjust inventory |
| Inventory Valuation Summary, Stock Status | 1.15 | PASS | Reports → Inventory |
| Fixed assets: SL / DDB / MACRS depreciation, register | 1.15 | PASS | Lists → Fixed assets |
| Attachments (transactions, customers, vendors) | 1.16 | PASS | Attachments card |
| Tax-line mapping (Sch C, 1120-S, 1065, 1120), Income Tax Summary, tax CSV | 1.16 | PASS (line numbers per 2025 forms; check each year) | Lists → Tax lines |
| Customer:Job, Profit and Loss by Job | 1.16 | PASS | Customer page → + New job |
| Billable costs re-billed on invoices; Unbilled Costs by Job | 1.16 | PASS | Bill/check/expense lines; invoice “+ Billable costs” |
| Sales orders | 1.17 | PASS | Create → Sales Order |
| Progress invoicing (estimates / sales orders), partial PO billing | 1.17 | PASS | Create Invoice dialog |
| Batch invoicing | 1.17 | PASS | Sales → Batch invoicing |
| Customer deposits / retainers | 1.17 | PASS | Customer page → Receive deposit; invoice “+ Apply deposit” |
| Price levels | 1.17 | PASS | Lists → Price levels |
| Sales tax: combined rates by agency, return per agency, Pay Sales Tax, exemption certificates | 1.18 (basic sales tax in 1.13) | PASS | Settings → Sales tax; Banking → Pay sales tax |
| Reports: A/R Collections, Missing Checks, Voided/Changed Transactions, Cash Flow Forecast | 1.18 | PASS | Reports |

**Still open (not built in this round):**
- Fixed-asset disposal gain/loss entry (disposal only stops depreciation).
- Re-costing earlier sales when a purchase is back-dated (average cost is fixed when a sale is posted).
- Real-world checks:
  - import the .iif with sales tax into QuickBooks Desktop;
  - print on real check stock;
  - open the exports in Microsoft Excel.
