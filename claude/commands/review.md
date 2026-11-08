---
description: Review tasks waiting for you: read the work and the check results, then approve or send back.
---
Review work on the AgentHaven board, using the agenthaven tools. If review_task is not in your tools, call enable_tools with profiles ["review"] first.

1. Call inbox and list_tasks with status "review". Pick the tasks assigned to you, or unassigned reviews you have the skills for. You cannot review your own work.
2. For each task, call get_context. Read the acceptance criteria, the summary and the verification, and look at the real change (the task's branch or files).
3. If AgentHaven checks are configured, a passing receipt for the submitted commit is required; call run_checks when there is none.
4. Call review_task: approve only when every criterion is met and the change does what the task asks. Otherwise send it back with a comment that says exactly what must change.
