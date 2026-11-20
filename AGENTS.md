# VaultBook (formerly OfflineBooks US) — Permanent AI Coding Instructions

> Product name is **VaultBook** (DEC-006). Where this file says "OfflineBooks US", read VaultBook. Storage identifiers in code keep the OfflineBooksUS names — never rename them.
> Layout: application in `app/` (open `app/index.html`); governance docs in `docs/`. Tests: `node app/tests/run-node.js`; `python3 app/tests/dev/e2e_playwright.py "$PWD/app/index.html"`; a11y: see `docs/AUDIT_BASELINE.md` §3.

## Mission
Upgrade the existing OfflineBooks US application into a polished, keyboard-first US accounting system inspired by Tally Prime's interaction principles. Preserve the existing application and improve it incrementally; do not rebuild from scratch without explicit approval.

## Non-negotiable rules
1. Inspect the current repository before changing code. Treat actual source code and tests as ground truth; verify saved notes against the repository.
2. Preserve US accounting behavior, double-entry integrity, existing data, IndexedDB schema, offline operation, security, backup/restore, and all working features.
3. Never silently remove, replace, stub, or hide an existing feature to make the redesign easier.
4. Keep presentation/UI concerns separate from accounting calculations and persistence wherever the existing architecture permits.
5. Do not introduce required cloud services, external databases, or internet dependencies.
6. Do not claim a task is complete without running relevant tests or documenting why tests could not run.
7. Never fabricate test results, screenshots, data, or verification evidence.
8. Avoid broad, risky rewrites. Make small, reviewable changes with clear rollback paths.
9. Do not mark a requirement complete merely because a screen exists. Verify behavior and acceptance criteria.
10. Keep all menus and visible controls functional. Do not create dead links, decorative actions, or placeholder features presented as complete.
11. Respect normal text editing, browser, operating-system, and accessibility shortcuts. Do not globally intercept keys while a user is typing in an input or editable field unless the shortcut is intentionally safe.
12. Do not copy Tally branding, logos, proprietary assets, source code, or exact visual identity. Build an original OfflineBooks US interface using comparable usability principles.
13. Do not add India-specific GST/TDS workflows unless explicitly requested. Design features for US accounting.
14. Protect user data. Before schema changes or migrations, document the risk, make the change versioned and reversible where possible, and verify backup/restore.
15. If blocked, record the blocker and work on safe, independent tasks when useful.

## Required working loop
At the start of each session:
1. Read this file and `docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/PROJECT_STATE.md`, `docs/DECISIONS.md`, and `docs/SCREEN_INVENTORY.md` if present.
2. Inspect Git status and the actual changed files.
3. Verify the saved project state against the code and test results.
4. Select the highest-priority unfinished task whose dependencies are satisfied.
5. Implement the smallest complete slice.
6. Run relevant tests and inspect for regressions.
7. Update task statuses and project state using evidence.
8. Save the exact next action before ending the session.

## Completion statuses
Use only:
- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `PASS`
- `FAIL`
- `NEEDS VERIFICATION`

A task can be `PASS` only when its acceptance criteria have evidence. If testing is unavailable, use `NEEDS VERIFICATION`, not `PASS`.

## End-of-session checkpoint
Update `docs/PROJECT_STATE.md` with:
- Date/time if available
- Current branch/commit if available
- Task worked on and files changed
- Tests run and exact results
- Known regressions or risks
- Blockers
- Exact next task and first action to perform

## Scope control
Do not attempt the entire redesign in one pass. Split work into tasks small enough to implement and verify independently. Keep requirement IDs stable. Do not delete or renumber requirements just because they are difficult. If requirements change, record why in `docs/DECISIONS.md` and update the traceability matrix.

Model and Credit Efficiency

Only use models available in my Claude Code account. Fable is unavailable, so never depend on it.

Haiku 5.5: simple edits, documentation, searches, and mechanical tasks.

Sonnet 5.5: default for implementation, UI development, testing, and routine debugging.

Opus 5.5: reserve for difficult architectural decisions, persistent bugs, and high-risk accounting or data-integrity problems.

Use the least expensive suitable model when model switching is supported. Do not repeatedly retry failed approaches. Keep tasks small, read only relevant files, run required tests, and update docs/RESUME.md before stopping.

Never compromise accounting correctness or data safety to reduce usage. If automatic model switching is unavailable, continue with the selected model and follow this policy without claiming a switch occurred.