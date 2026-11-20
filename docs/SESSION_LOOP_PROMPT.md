# Session Loop Prompt

Continue the existing OfflineBooks US project from its saved project files.

1. Read `AGENTS.md`, then `docs/RESUME.md` and `docs/PROJECT_STATE.md`.
2. Check actual repository status/diff and verify the checkpoint.
3. Open only source/spec files needed for the next task.
4. Select the highest-priority unfinished task with satisfied dependencies.
5. Implement one small, safe, complete task.
6. Run relevant tests and inspect regressions. Do not fabricate results.
7. Update `docs/IMPLEMENTATION_PLAN.md`, `docs/SCREEN_INVENTORY.md` when relevant, `docs/PROJECT_STATE.md`, and `docs/RESUME.md`. Append one concise audit-log entry.
8. Mark `PASS` only when acceptance criteria are verified. Otherwise use `NEEDS VERIFICATION`, `FAIL`, or `BLOCKED`.
9. Continue if time/context/tool limits allow. If nearing a limit, stop starting new work and save a checkpoint first.

Preserve existing accounting behavior, IndexedDB data, offline operation, security, backup/restore, and existing features. Do not restart the plan from scratch or reread the entire repository without a reason. Never mark an untested screen complete.

If blocked on one task, record the cause and proceed with safe independent work when possible. After two failed attempts at the same issue, pause retries, diagnose, and record a bounded next step.

Before ending, ensure the resume checkpoint states the exact next action and source files to open. The goal is the complete application, not a visual-only redesign.
