---
target: review this project find me bug and design flow
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/claude/src/VaultBook/app/index.src.html"
target_fingerprint: "sha256:ae005b9df2950441a3073ae8eae99b44c4e1aae3054e623d58ffa92e3e5999f7"
target_path: /home/claude/src/VaultBook/app/index.src.html
timestamp: 2026-11-20T21-02-24Z
slug: app-index-src-html
---
# VaultBook critique (dual-agent), v1.55.2, app/index.src.html
Total 24/40 (Acceptable). P0: 0, P1: 3.

Heuristics: 1=3 (unsaved shown 3x; period mismatch), 2=2 (Tally jargon, "Match Windows"), 3=2 (Esc drops customer modal input; tab sprawl), 4=1 (two form designs, primary moves, desktop vs phone languages), 5=2 (payment unapplied silently; delete-company check after close), 6=3, 7=4, 8=1 (~60 chrome controls), 9=3 (settings save reason hidden), 10=3 (F1 top clipped).

Specificity: behavior Tally/QB-specific; visuals generic SaaS; phone (#/m, ui-mobile.js) iOS look #0066cc vs desktop #1f4fd1.
Detector: 6 findings, 2 true (dark .cal-cell.today 2.5:1 vault.css:650; .logo-preview #fff app.css:392 2.3:1), 1 source-only (theme.css:88 glow), 3 FP (kbd keycap x2, calendar hour grid). No console errors on 29 routes x4 modes. Build fresh.

Priority issues:
- [P1] Receive Payment no auto-apply -> hidden unapplied credit, invoice Open, dashboard contradicts. Auto-apply oldest-first on amount; confirm leftover credit. /impeccable harden
- [P1] Modal no focus trap; .mbar z70 over .modal-backdrop z50; invisible cmdbar buttons focusable (studio.css:72). Trap Tab, inert, z-order. /impeccable audit
- [P1] Two transaction form designs (invoice vs expense/bill/payment), primary button moves. One template. /impeccable polish
- [P2] Chrome overload, duplicate window tabs persist. /impeccable distill
- [P2] Phone tables clipped, tab bar covers footers; first-run dead toolbar, sample+QB both tickable (ui-pages.js:60), "Well done" empty dash. /impeccable adapt, /impeccable onboard

Bugs: settings?tab=foo crash (ui-settings.js:21); settings save failure reason hidden; logo PNG re-encode rejects photos (ui-settings.js:79, ledger.js:410); mobile feed lists oca accounts (ui-mobile.js:331); chart "Fiscal year to date" plots last 12 months (ui-studio.js:131); unknown route silent Gateway; company name no engine length cap.

Personas: Alex (Alt+C, F10 labels, tab dupes, moving primary), Jordan (jargon, payment trap, no checklist), Sam (focus trap, unlabeled #delname ui-pages.js:81, line delete 1.7:1 app.css:823, win-ctl focus 1.1:1, double h1 on reports), bookkeeper (no auto-apply, Undeposited Funds, Deposit-to lists Inventory Asset, contra in red).
