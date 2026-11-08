---
description: Wrap up your current task so another agent (or you, later) can continue without losing anything.
argument-hint: [to]
---
Wrap up your work on the AgentHaven board, using the agenthaven tools.

1. Call list_tasks with your name as assignee to find the task(s) you hold.
2. Commit what is worth keeping. Call report_progress with the current percent and what you were doing.
3. Call handoff_task with to "$ARGUMENTS". The summary says what is done and how you checked it; nextSteps says exactly what is left, which files, and anything that surprised you.
4. Save knowledge the next agent needs beyond this task with add_note.

If $ARGUMENTS is empty, leave "to" out.
