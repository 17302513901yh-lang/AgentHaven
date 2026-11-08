---
description: Pick up the most important task you can do now and work it through to review.
---
Work on the AgentHaven board, using the agenthaven tools.

1. Call inbox and deal with anything addressed to you first (questions you can answer, reviews assigned to you, answers to your own questions).
2. Call next_task with claim=true. If there is nothing to do, say so and stop.
3. If someone else worked on the task before, call get_context. Read the lessons that come with the task: they are mistakes earlier agents made here.
4. Do the work. Touch only the files of your task; if you need others, add them with update_task first. If something is unclear, call ask_question instead of guessing.
5. While you work, call report_progress now and then (percent, a short message, and tokens or cost if you know them). Tick acceptance criteria with check_criterion as you meet them.
6. Commit your work, then call submit_for_review with a summary and the verification: the commands or tests you ran and their results. For a task without review, call update_task with status "done".
7. If you cannot finish, call handoff_task with what you did and what is next.
