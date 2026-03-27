# Delays and Blocks

Demonstrates `+delayed:X` and `+blocked:X` — secondary modifiers that add time to the
timeline while keeping the task's real status intact. Both show a ghost bar at the
original planned position so you can see the slip at a glance.

- **`delayed X`** — internal slip (orange ghost bar)
- **`blocked X`** — held up by an external factor (red ghost bar)

```yatt
title: Sprint with Delays & Blocks
owner: @pm
start: 2026-04-07
schedule: business-days

[x] Kickoff & planning | 2bd | @pm | #kickoff

[~] Backend API | 6bd | @alice | #api | after:kickoff | delayed 3d
// Was planned for Mon; environment issues pushed start to Thu.
// Ghost bar shows original planned window.

[~] SWIFT certification | 8bd | @carol | #swift | after:kickoff | blocked 2w
// Waiting on SWIFT sandbox credentials (submitted 2026-03-14).
// Task is active but cannot proceed for ~2 weeks.

[ ] Frontend integration | 5bd | @bob | #frontend | after:kickoff
// No slip — shown for comparison.

[ ] QA & sign-off | 3bd | @qa | after:api,swift,frontend
```
