# YATT Language Specification

---

## Syntax Cheatsheet

```
title: My Project
start: 2026-04-01
schedule: business-days

# Section name

[ ] Task name | 3d | @alice | #tag | !high | %40 | id:slug | after:other | <2026-05-01
// Optional description line (immediately follows the task)
// More description — shown as tooltip or annotation.

[~] Active task | 2bd | @bob | delayed 2d
[x] Done task   | 1w  | @carol | %100
[~] Blocked     | 4d  | @dave | blocked 1w
[=] In review   | 2d
[?] At risk     | 3d | !high
[>] Deferred    | 2d
[_] Cancelled   | 1d

>> Milestone name | >2026-05-15 | +deadline | id:ms

parallel: workstream-name | after:slug
[ ] Task A | 3d
[ ] Task B | 2d
end: workstream-name

[~] Parent task | 5d | id:parent
.  [x] Sub one  | 2d
.  [ ] Sub two  | 3d
.. [ ] Nested   | 1d

*daily  Standup   | 15m | @team
*weekly Review    | 1h
```

---

## Header Block

`key: value` lines at the top of the file, before any task lines. All fields are optional.

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Untitled"` | Display name |
| `start` | `YYYY-MM-DD` | today | Absolute schedule start date |
| `end` | `YYYY-MM-DD` | derived | Optional hard end date |
| `schedule` | `calendar-days` \| `business-days` | `calendar-days` | Default duration semantics |
| `timezone` | IANA timezone | `UTC` | For date calculations |
| `locale` | BCP 47 tag | `en` | Date formatting in output |
| `owner` | string | — | Default assignee for tasks without `@` |
| `week-start` | `mon` \| `sun` | `mon` | First day of week |
| `version` | string | — | Free-form version label |

Header parsing ends at the first non-header, non-blank, non-comment line.

---

## Line Classification

Lines are classified in this order (first match wins):

| Pattern | Classification |
|---|---|
| Starts with `//` | Comment / task description |
| `key: value` in header zone | Header field |
| Starts with `#` + space | Section header |
| Starts with `>>` | Milestone |
| Starts with `parallel:` | Parallel block open |
| Starts with `end:` | Parallel block close |
| Starts with `*` | Recurring task |
| Starts with `.`+ space + `[` | Subtask |
| Starts with `[` | Task |
| Blank line | Ignored |
| Anything else | Parse warning; line skipped |

---

## Task Syntax

```
[status] Task name | field | field | field ...
// Optional description line
// Another description line
```

The status token uses either sigil or word form. The task name is everything after `]` up to the first `|`, trimmed. Fields are pipe-separated and order-independent.

**Task descriptions:** `//` lines immediately following a task (with no blank line in between) are that task's description. They are displayed as a tooltip or annotation in rendered output. Standalone `//` lines not immediately following a task are ignored by the parser.

### Status Vocabulary

| Sigil | Word | Colour | Scheduling |
|---|---|---|---|
| `[ ]` | `new` | steel blue | Normal |
| `[~]` | `active` | blue | Normal |
| `[x]` | `done` | green | Normal (historical) |
| `[!]` | `blocked` | red + stripes | Normal (chain continues unless `+hard-block`) |
| `[?]` | `at-risk` | amber | Normal |
| `[>]` | `deferred` | purple | Skipped in chain (zero-duration for deps) |
| `[_]` | `cancelled` | grey + strikethrough | Fully excluded |
| `[=]` | `review` | violet | Normal |
| `[o]` | `paused` | slate-dark | Normal |

`deferred` — the following task starts where the deferred task would have started.  
`cancelled` — fully excluded; downstream `after:` references resolve to its start date.

### Field Reference

| Sigil | Name | Example | Notes |
|---|---|---|---|
| (no sigil) | duration | `3d`, `2bd`, `1w` | Defaults to `1d` if absent |
| `@` | assignee | `@alice`, `@alice @bob` | Multiple: space-separated or repeat `@` fields |
| `#` | tag | `#backend` | Multiple allowed |
| `!` | priority | `!high` | `critical` / `high` / `medium` / `low` |
| `%` | progress | `%40` | Integer 0–100; fills bar |
| `id:` | task ID | `id:auth-refactor` | Slug; unique per document |
| `after:` | dependency | `after:a,b` / `after:a\|b` | AND (comma) or OR (pipe) |
| `+` | modifier | `+deadline`, `+fixed` | See Modifiers section |
| (space-separated) | time-shift | `delayed 3d`, `blocked 2w` | See Time-shift Modifiers |
| `>` | start floor | `>2026-03-01` | Task can't start before this date |
| `<` | soft due date | `<2026-03-31` | Flags overrun visually |
| `$` | ticket ref | `$JIRA-42` | Opaque; rendered as link if URL template configured |

---

## Duration Grammar

A duration is a positive number (integer or decimal) followed immediately by a unit suffix, no spaces.

| Suffix | Meaning | Respects `schedule` setting? |
|---|---|---|
| `h` | Hours | No — always calendar hours |
| `d` | Calendar or business days | Yes |
| `bd` | Business days | Always business days |
| `w` | Weeks (7 calendar days) | No |
| `m` | Calendar months | No |
| `q` | Quarters (3 months) | No |

Examples: `3d`, `5bd`, `2w`, `1.5h`, `0.5m`, `1q`. Decimal durations are valid. Compound durations (`2w3d`) are not supported.

---

## Scheduling Model

Tasks are scheduled sequentially by default — Task N starts the day after Task N−1 ends. The first task starts on the document `start` date.

**Start date resolution (in order of precedence):**

1. `after:` dependencies — start is the maximum end date of all resolved deps (AND) or minimum (OR).
2. `>start-date` field — task cannot start before this date; whichever is later wins.
3. Sequential position — starts immediately after the preceding task ends.

`deferred` and `cancelled` tasks are skipped in the sequential chain. `done` tasks occupy their slot normally (start + duration); they are historical.

`+fixed` combined with `>date` pins the task absolutely — no upstream dependency can push it later.

---

## Parallel Blocks

```
parallel: blockname | after:other | >start-date
[ ] Task A | 3d | @alice
[ ] Task B | 2d | @bob
end: blockname
```

Tasks within a block are scheduled sequentially among themselves, starting at the block's anchor point. Multiple parallel blocks opening at the same document position run concurrently — they do not advance the outer sequential chain. The block name is its implicit ID for `after:` references.

**Block completion:** `after:blockname` resolves to the end date of the last task in that block (the latest end across all members). To sequence the outer chain after parallel blocks, use explicit `after:` references:

```
parallel: phase-a
[ ] Work A | 3d
end: phase-a

parallel: phase-b
[ ] Work B | 2d
end: phase-b

[ ] Integration | 2d | after:phase-a,phase-b
```

Block names and task IDs share the same namespace. Nested parallel blocks are not supported.

---

## Task IDs and Dependencies

**IDs** (`id:slug`) are slugs (lowercase letters, digits, hyphens), unique within the document. Tasks without an `id:` cannot be referenced by `after:`. Subtask IDs are in the same global namespace as top-level IDs.

**AND dependency** (`after:a,b`) — starts after all listed deps have ended.  
**OR dependency** (`after:a|b`) — starts after any one dep has ended.  
AND and OR cannot be mixed on the same `after:` field.

The parser performs cycle detection after resolving all `after:` references. A circular dependency is a parse error.

---

## Subtasks

```
[~] Parent task | 5d | @alice | id:parent
.  [x] Research   | 1d
.  [~] Implement  | 3d | id:impl
.. [ ] Unit tests | 1d
.. [ ] Integration| 1d | after:impl
.  [ ] Review     | 1d
```

Leading dots indicate depth: `.` = level 1, `..` = level 2, `...` = level 3. Subtasks are scheduled sequentially within the parent, starting at the parent's start date.

If the parent has no explicit duration, it is computed as the sum of its subtasks' durations. If the parent has no explicit `%progress`, it is the weighted average of subtask progress (by duration).

---

## Milestones

```
>> Milestone name | >2026-03-15 | +deadline | id:go-live | after:phase1
```

Milestones have zero duration and appear as a point (diamond ◆) on the timeline. If a `>date` field is present, the milestone is pinned to that date; otherwise its date is the end of the preceding sequential element. Milestones accept `id:`, `after:`, `>`, `+modifier`, `@`, and `#` fields. They participate in the sequential chain (zero duration — start and end are the same day).

---

## Modifiers

Modifiers are `+keyword` fields that attach flags to tasks or milestones.

| Modifier | Scheduling Effect | Rendering Effect |
|---|---|---|
| `+deadline` | Emits overrun warning if computed end > `<due-date` | Red flag/diamond at due date |
| `+fixed` | Pins task to `>start-date`; deps cannot push it later | Lock icon or hatched bar |
| `delayed X` | Shifts start+end forward by X; stores original as `plannedStart`/`plannedEnd` | Orange ghost bar at original position |
| `blocked X` | Same time-shift; semantically: held up externally | Red ghost bar at original position |
| `+hard-block` | Stops sequential chain at this blocked task | — |
| `+external` | None | Different bar colour (third-party/vendor work) |
| `+critical` | None | Bold/bright bar (critical path) |
| `+tentative` | None | Dashed bar or diamond outline |
| `+at-risk` | None | Yellow warning icon |
| `+waiting` | None | Clock icon |

### Time-Shift Modifiers

`delayed X` and `blocked X` accept a duration value (`3d`, `2w`, `1bd`, etc.) and push the task's computed start and end forward by that amount. The original (unshifted) dates are preserved and rendered as a ghost bar:

- **`delayed X`** — internal slip (team-side). Ghost bar is **orange**.
- **`blocked X`** — held up by an external factor for a known duration. Ghost bar is **red**.

```
[~] API integration      | 5d | @alice | delayed 3d
// Was planned for Mon; environment issues pushed start to Thu.

[~] SWIFT certification  | 8d | @carol | blocked 2w
// Waiting on SWIFT sandbox credentials — estimated 2-week hold.
```

Both can be applied to the same task; shifts are applied sequentially.

---

## Recurring Tasks

```
*daily     Standup             | 15m | @team
*weekday   Async update        | 5m  | @team
*weekly    Sprint planning     | 2h  | @team
*biweekly  Architecture sync   | 1h  | @leads
*monthly   Stakeholder review  | 2h  | @pm
*quarterly Business review     | 3h  | @exec
```

Recurring tasks do not participate in the sequential scheduling chain and do not affect other tasks' start dates. They are rendered as repeating blocks across the document's date range.

---

## Sections and Comments

**Sections** (`#` or `##` + space + name) group tasks visually. They have no effect on scheduling. A renderer may draw a divider row with the section label.

**Standalone comments** (`//` lines not immediately following a task) are ignored by the parser. A `//` sequence within a task name or field value is treated as literal characters.

**Task descriptions** (`//` lines immediately following a task, with no blank line) are attached to that task as its description. See Task Syntax above.

---

## Formal Grammar

PEG-style sketch (informative, not normative):

```peg
Document       <- Header? Body
Header         <- HeaderLine+
HeaderLine     <- Key ":" SP Value NL
Key            <- [a-z] [a-z0-9-]*
Value          <- (!NL .)+

Body           <- BodyLine*
BodyLine       <- Comment / Section / Milestone / ParallelOpen
               / ParallelClose / RecurringTask / Subtask / Task
               / BlankLine

Comment        <- "//" (!NL .)* NL
Section        <- "#"+ SP Name NL
Name           <- (!NL .)+

Milestone      <- ">>" SP Name PipeFields? NL

ParallelOpen   <- "parallel:" SP BlockName PipeFields? NL
ParallelClose  <- "end:" (SP BlockName)? NL
BlockName      <- [a-zA-Z0-9_-]+

RecurringTask  <- "*" RecurToken SP Name PipeFields? NL
RecurToken     <- "daily" / "weekday" / "weekly" / "biweekly"
               / "monthly" / "quarterly"

Subtask        <- Dots SP "[" Status "]" SP Name PipeFields? NL
Dots           <- "." / ".." / "..."

Task           <- "[" Status "]" SP Name PipeFields? NL

Status         <- " " / "~" / "x" / "!" / "?" / ">" / "_" / "=" / "o"
               / "new" / "active" / "done" / "blocked" / "at-risk"
               / "deferred" / "cancelled" / "review" / "paused"

PipeFields     <- (SP? "|" SP? Field)+
Field          <- DurationField / AssigneeField / TagField / PriorityField
               / ProgressField / IdField / AfterField / ModifierField / ShiftField
               / StartDateField / DueDateField / TicketField

DurationField  <- NUMBER ("h" / "bd" / "d" / "w" / "m" / "q")
AssigneeField  <- "@" [a-zA-Z0-9_-]+ (SP "@" [a-zA-Z0-9_-]+)*
TagField       <- "#" [a-zA-Z0-9_-]+
PriorityField  <- "!" ("critical" / "high" / "medium" / "low")
ProgressField  <- "%" [0-9]+ ("%"?)
IdField        <- "id:" Slug
AfterField     <- "after:" Slug ("," Slug)* / "after:" Slug ("|" Slug)*
ModifierField  <- "+" ModifierWord
ShiftField     <- ("delayed" / "blocked") SP DurationField
StartDateField <- ">" ISODate
DueDateField   <- "<" ISODate
TicketField    <- "$" [A-Z0-9_-]+

Slug           <- [a-z0-9-]+
ISODate        <- [0-9]{4} "-" [0-9]{2} "-" [0-9]{2}
NUMBER         <- [0-9]+ ("." [0-9]+)?
SP             <- " "+
NL             <- "\n" / "\r\n"
```

---

## Rendering Model

A rendered YATT document is a horizontal Gantt chart with one row per task, subtask, and milestone; section headers as divider rows; and a date axis scaled to the full document range.

**Bar colours by status:** `new` → steel blue · `active` → blue · `done` → green · `blocked` → red stripes · `at-risk` → amber · `deferred` → grey · `cancelled` → light grey + strikethrough · `review` → violet · `paused` → slate-dark.

**Progress fill:** `%progress` splits the bar — filled portion uses the status colour; remainder uses a lighter tint. `%100` renders identically to `done`.

**Standard annotations:** today line (vertical dashed), overrun highlight (if computed end > `<due-date`), assignee initials on bars, optional dependency arrows, hover tooltips on interactive renderers.
