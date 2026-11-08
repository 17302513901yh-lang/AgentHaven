---
description: Turn a goal into small tasks with files, acceptance criteria and dependencies, so several agents can work in parallel.
argument-hint: <goal>
---
Turn this goal into work on the AgentHaven board, using the agenthaven tools:

Goal: $ARGUMENTS

1. Call list_tasks and search_notes so you do not plan work that already exists.
2. Read enough of the code to know which files each part touches.
3. Create tasks with create_task. Each task is small enough for one session, lists its files (so parallel agents do not collide), has acceptance criteria that can be checked, and names the skills it needs. Use dependsOn for what must come first, and review=true for risky changes.
4. Show your user the plan as a short list (title, files, depends on) and ask before anyone starts, unless they told you to go ahead.
