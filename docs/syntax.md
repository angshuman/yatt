# YATT Syntax Guide

This is a learn-by-example guide to writing YATT files. It's meant to get you productive quickly — not to be exhaustive. For the full specification, see [SPEC.md](../SPEC.md).

---

## Your First Task List

Start simple. A YATT file is just a list of tasks.

```yatt
[ ] Write project brief
[ ] Gather stakeholder feedback
[ ] Finalize scope
```

Three tasks. They'll be scheduled sequentially starting today, each taking the default duration of one day. This is already a valid YATT file — you can paste it into any integration and get a (very short) Gantt chart.

### Add a project header

```yatt
title: Website Refresh
start: 2026-02-01
schedule: business-days

[ ] Write project brief       | 2d
[ ] Gather stakeholder feedback | 3d
[ ] Finalize scope            | 1d
```

The header block sets the project name, start date, and tells YATT to use business days for durations (so `2d` means two working days, skipping weekends). Each task now has an explicit duration after the `|`.

### Add dates and assignees

```yatt
title: Website Refresh
start: 2026-02-01
schedule: business-days

[ ] Write project brief         | 2d | @jess
[ ] Gather stakeholder feedback | 3d | @jess | @mike
[ ] Finalize scope              | 1d | @jess
```

`@` assigns a person to a task. You can have multiple assignees on one task by listing them space-separated within a single `@` field, or as separate `@` fields.

### Track status and progress

```yatt
title: Website Refresh
start: 2026-02-01
schedule: business-days

[x] Write project brief         | 2d | @jess | %100
[~] Gather stakeholder feedback | 3d | @jess | @mike | %60
[ ] Finalize scope              | 1d | @jess
```

`[x]` means done. `[~]` means in progress. `%60` means 60% complete. The renderer draws a partially filled bar for active tasks.

---

## Status Guide

Every task has a status in square brackets. There are nine statuses — here's when to use each one.

| Status | When to use |
|---|---|
| `[ ]` or `[new]` | The default. Work hasn't started. |
| `[~]` or `[active]` | Currently being worked on. Add a `%progress` field. |
| `[x]` or `[done]` | Finished. No further action needed. |
| `[!]` or `[blocked]` | Can't proceed until something else is resolved. Usually paired with `+blocked` modifier and a note. |
| `[?]` or `[at-risk]` | Work is progressing but there's a concern. Still shows in the schedule. |
| `[>]` or `[deferred]` | Pushed to later. The task is skipped in scheduling — the next task starts where this one would have. |
| `[_]` or `[cancelled]` | Removed from scope. Fully excluded from scheduling. |
| `[=]` or `[review]` | Work is done, waiting for sign-off or approval. |
| `[o]` or `[paused]` | Work started but temporarily stopped. |

Both forms (`[ ]` and `[new]`) are equivalent. Use whichever reads better in your file. Short sigils are compact; word forms are self-documenting.

```yatt
[x]  Requirements  | 3d | @ana | %100
[~]  Design        | 5d | @ben | %50
[=]  Prototype     | 2d | @ana
[ ]  Development   | 8d | @cai
[!]  API access    | 1d | @cai | +blocked
[>]  Nice-to-haves | 3d
[_]  Old approach  | 2d
```

---

## Working with Dates and Durations

### Duration units

| Suffix | Meaning |
|---|---|
| `h` | Hours |
| `d` | Days (calendar or business, depending on `schedule`) |
| `bd` | Business days (always, regardless of `schedule`) |
| `w` | Weeks (always 7 calendar days) |
| `m` | Months |
| `q` | Quarters |

```yatt
[ ] Quick review   | 2h
[ ] Feature work   | 5d
[ ] Integration    | 3bd
[ ] Testing sprint | 2w
[ ] Beta phase     | 1m
[ ] Planning cycle | 1q
```

### The `schedule` header

```yatt
schedule: business-days
```

When you set `schedule: business-days`, the bare `d` suffix automatically means business days throughout the document. You don't need to write `bd` on every task. If you mix `d` and `bd` in the same document with `schedule: business-days`, they mean the same thing. Use `bd` explicitly when you want business days regardless of the schedule setting.

### Pinning a task's start date

Use `>date` to say "this task cannot start before this date":

```yatt
[ ] Vendor onboarding | 3d | >2026-03-10 | +external
```

If the sequentially computed start date is already after March 10, the `>` has no effect. If sequential scheduling would start the task earlier, the task is pushed to March 10 — creating a gap.

### Setting a deadline

Use `<date` to set a soft deadline:

```yatt
[ ] Draft report | 4d | <2026-03-28
```

If the computed end date would exceed March 28, the renderer highlights the overrun. Combine with `+deadline` to make this a hard visual warning:

```yatt
[ ] Submit to regulator | 4d | <2026-03-28 | +deadline
```

---

## Sequential vs Parallel: The Key Concept

### Sequential (default)

By default, YATT schedules tasks one after another:

```yatt
title: Launch Plan
start: 2026-01-01

[ ] Phase 1 | 5d
[ ] Phase 2 | 3d   // starts Jan 6
[ ] Phase 3 | 2d   // starts Jan 9
```

Phase 2 starts the day Phase 1 ends. Phase 3 starts the day Phase 2 ends. You don't need to say this explicitly — it's the default.

### Parallel blocks

Use `parallel:` to run multiple workstreams concurrently:

```yatt
title: App Launch
start: 2026-01-05

[ ] Requirements | 3d

parallel: frontend
[ ] UI design    | 4d
[ ] Frontend dev | 6d
end: frontend

parallel: backend
[ ] DB schema    | 2d
[ ] API layer    | 5d
end: backend

[ ] Integration  | 3d | after:frontend,backend
```

The two `parallel:` blocks start at the same time (right after "Requirements"). The "Integration" task waits for *both* to finish before starting. The `after:` field on "Integration" is the explicit glue — block names are valid dependency targets.

### Multiple independent blocks

You can have as many parallel blocks as you need:

```yatt
parallel: design
[ ] Wireframes | 4d
end: design

parallel: content
[ ] Copywriting | 5d
end: content

parallel: infrastructure
[ ] Server setup | 2d
end: infrastructure

[ ] Final integration | 2d | after:design,content,infrastructure
```

All three blocks run concurrently. The final task waits for all of them.

---

## Naming Tasks for Dependencies

When a task in one part of the document needs to wait for a specific task in another part, use `id:` to name it and `after:` to reference it.

### Giving a task an ID

```yatt
[x] Data migration | 3d | id:migration
```

IDs are lowercase slugs (letters, numbers, hyphens). They must be unique in the document.

### Referencing a dependency

```yatt
[ ] API tests | 2d | after:migration
```

This task won't start until "Data migration" is complete, regardless of where in the document it appears.

### AND dependencies

Wait for multiple tasks to all finish:

```yatt
[ ] Deploy to staging | 1d | after:backend-tests,frontend-tests
```

### OR dependencies

Start as soon as *any one* of the listed tasks finishes:

```yatt
[ ] Early review | 1d | after:design-v1|design-v2
```

This is useful when you have alternative paths and want to proceed with whichever completes first.

### Cross-block dependencies

IDs from inside parallel blocks are accessible everywhere:

```yatt
parallel: api-team
[ ] Auth endpoints | 3d | id:auth-done
[ ] Data endpoints | 4d
end: api-team

parallel: frontend-team
[ ] Login page | 2d | after:auth-done   // waits for auth specifically
[ ] Dashboard  | 4d
end: frontend-team
```

The `after:auth-done` inside the `frontend-team` block pulls in a dependency from the `api-team` block by ID.

---

## Subtasks

Use dots to nest subtasks under a parent:

```yatt
[~] Build checkout flow | 6d | @dev | %45
.  [x] Cart review page     | 1d | @dev | %100
.  [~] Payment form         | 2d | @dev | %60 | id:payment-form
.. [x] Card input fields    | 0.5d | @dev | %100
.. [~] Validation logic     | 1d | @dev | %30
.. [ ] Error handling       | 0.5d | @dev | after:payment-form
.  [ ] Order confirmation   | 1d | @dev
.  [ ] Email receipt        | 1d | @dev
```

- One dot (`.`) = level 1 subtask
- Two dots (`..`) = level 2 subtask
- Three dots (`...`) = level 3 subtask (maximum depth)

Subtasks are scheduled sequentially within their parent, starting at the parent's start date. You can use `after:` and `id:` on subtasks just like on top-level tasks. IDs are document-global, so a subtask's ID can be referenced from anywhere.

If the parent has no explicit duration, it is computed from the sum of its subtasks.

---

## Milestones

A milestone marks a specific point in time — a release, a decision, a handoff. It has zero duration.

```yatt
>> Design approval | >2026-02-14 | +deadline | id:design-approved
```

The `>>` sigil designates a milestone. The `>2026-02-14` pins it to a specific date. Without a date, the milestone falls at the end of the preceding sequential element.

```yatt
[ ] Write spec      | 3d | id:spec-done
[ ] Technical review | 2d
>> Spec approved    | id:spec-approved      // falls at end of "Technical review"

[ ] Implementation  | 8d | after:spec-approved
```

Milestones participate in the sequential chain. Tasks that `after:` a milestone start on the milestone's date.

### Deadline milestones

```yatt
>> Regulatory filing | >2026-06-30 | +deadline | id:filing
```

The `+deadline` modifier renders this milestone in red and triggers warnings if anything it depends on would push it past the date.

---

## Modifiers Reference

Modifiers are `+keyword` flags. They don't change scheduling (with one exception) but they change rendering and communicate intent.

| Modifier | Meaning | Use case |
|---|---|---|
| `+deadline` | Hard deadline — warn loudly if overrun | Regulatory dates, contractual commitments |
| `+fixed` | Task is pinned to its start date and cannot be moved by upstream delays | Booked conference rooms, vendor slots |
| `+external` | Work is owned by someone outside the team | Vendor deliveries, client approvals |
| `+waiting` | Blocked on external response | Waiting for legal sign-off, vendor quote |
| `+at-risk` | Something could go wrong | Tasks with unclear requirements or dependencies |
| `+blocked` | Currently blocked | Use with `[!]` status |
| `+critical` | On the critical path | Highlights the chain that determines the project end date |
| `+tentative` | Not confirmed | Scheduled placeholders, proposed dates |
| `+milestone` | Treat as a zero-duration milestone | When you want milestone rendering on a regular task line |

Combine modifiers freely:

```yatt
[ ] Vendor hardware delivery | 3d | @supplier | +external | +fixed | >2026-03-15 | +critical
```

---

## Tips and Common Patterns

### Plan a sprint

```yatt
title: Sprint 14
start: 2026-02-17
schedule: business-days

# Frontend
[~] Redesign nav bar     | 3d | @kai  | %50  | $JIRA-401 | id:nav
[ ] Mobile responsiveness | 2d | @kai  | after:nav | $JIRA-402

# Backend
[~] Optimize search index | 4d | @mia  | %25  | $JIRA-403
[ ] Rate limiting API     | 2d | @mia  | $JIRA-404

# QA
[ ] Regression suite      | 3d | @sam  | after:nav

>> Sprint 14 complete | id:sprint-14-done
```

### Track a multi-team project

Use one parallel block per team:

```yatt
parallel: team-alpha | after:kickoff
[ ] Feature A design  | 3d | @alpha-lead
[ ] Feature A build   | 5d | @alpha-dev | after:feature-a-design | id:feature-a-build
end: team-alpha

parallel: team-beta | after:kickoff
[ ] Feature B design  | 2d | @beta-lead | id:feature-b-design
[ ] Feature B build   | 4d | @beta-dev  | after:feature-b-design
end: team-beta
```

### Mark recurring ceremonies

```yatt
*weekly   Standup        | 15m | @team    | #ceremony
*biweekly Sprint planning | 2h  | @team   | #ceremony
*monthly  Stakeholder sync | 1h | @leads  | #ceremony
```

Recurring tasks are rendered as repeating bars across the timeline. They don't affect sequential scheduling of other tasks.

### Use sections to organize without affecting scheduling

```yatt
# Discovery
[x] Research    | 3d
[x] Interviews  | 2d

# Design
[~] Wireframes  | 4d | %60
[ ] Mockups     | 3d

# Build
[ ] Frontend    | 8d
[ ] Backend     | 6d
```

Sections are visual groupings only. The scheduling chain runs continuously across section boundaries.

### Defer and cancel cleanly

```yatt
[>] Phase 3 (Q3 scope) | 10d   // deferred — skipped in scheduling
[_] Old approach       | 5d    // cancelled — excluded entirely
[ ] Current priority   | 3d    // starts as if the above two didn't exist
```

Deferred tasks appear in the chart as greyed-out blocks. Cancelled tasks may be hidden or shown with strikethrough depending on renderer settings.

---

For the full language reference — including the formal grammar, all field types, and advanced scheduling rules — see [SPEC.md](../SPEC.md).
