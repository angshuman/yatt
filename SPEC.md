# YATT Language Specification

**Version:** 0.1.0
**Status:** Draft

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [File Format and Header Block](#2-file-format-and-header-block)
3. [Line Classification Rules](#3-line-classification-rules)
4. [Task Line Anatomy](#4-task-line-anatomy)
5. [Status Vocabulary](#5-status-vocabulary)
6. [Field Reference](#6-field-reference)
7. [Duration Grammar](#7-duration-grammar)
8. [Date Expressions](#8-date-expressions)
9. [Sequential Scheduling Model](#9-sequential-scheduling-model)
10. [Parallel Blocks](#10-parallel-blocks)
11. [Task IDs and Dependencies](#11-task-ids-and-dependencies)
12. [Subtask Dot Notation](#12-subtask-dot-notation)
13. [Milestones](#13-milestones)
14. [Modifier System](#14-modifier-system)
15. [Recurring Tasks](#15-recurring-tasks)
16. [Sections](#16-sections)
17. [Comments](#17-comments)
18. [Formal Grammar](#18-formal-grammar)
19. [Rendering Model](#19-rendering-model)
20. [Version History](#20-version-history)

---

## 1. Design Philosophy

YATT is built on five principles that guide every design decision.

### 1.1 Plain Text First

A YATT file must be useful without any tooling. It should read naturally as a plain-text document — in a terminal, a code review, an email. Rendering to a Gantt chart is an enhancement, not a requirement for comprehension.

### 1.2 No Whitespace Syntax

Indentation is never load-bearing. Two spaces and four spaces have the same meaning. The only exception is the subtask dot notation, which uses leading dots (`.`) rather than spaces. This makes YATT safe to edit in any text editor without fear of breaking structure through reformatting.

### 1.3 Sigil-Driven

Every structural element begins with an unambiguous sigil: `[` for tasks, `>>` for milestones, `#` for sections, `//` for comments, `.` or `..` for subtasks, `*` for recurrence, `parallel:` and `end:` for block delimiters. Sigils eliminate parsing ambiguity without requiring indentation or keyword position sensitivity.

### 1.4 Sequential by Default

Tasks in a document are scheduled sequentially — each task starts when the previous one ends — unless explicitly overridden. This matches the mental model of most project plans: a list of things to do, one after another. Parallelism is opt-in and explicit via `parallel:` blocks or `after:` cross-references.

### 1.5 Domain-Agnostic

YATT has no knowledge of software sprints, construction phases, or any other domain. It understands tasks, durations, assignees, and dependencies. All domain meaning is carried by names, tags, and the user's choice of structure. The same parser handles a software release and a kitchen renovation.

---

## 2. File Format and Header Block

### 2.1 Encoding

YATT files use UTF-8 encoding. The canonical file extension is `.yatt`. YATT content embedded in Markdown uses a fenced code block with the `yatt` language identifier.

### 2.2 Header Block

The header block consists of `key: value` lines at the top of the file, before any task lines. Header parsing ends at the first line that does not match `key: value` syntax (ignoring blank lines and comment lines).

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Untitled"` | Display name of the project or plan |
| `start` | ISO date `YYYY-MM-DD` | today | Absolute start date for scheduling |
| `end` | ISO date `YYYY-MM-DD` | derived | Optional hard end date; triggers overrun warnings |
| `schedule` | `calendar-days` \| `business-days` | `calendar-days` | Default duration unit semantics |
| `timezone` | IANA timezone string | `UTC` | Timezone for date calculations |
| `locale` | BCP 47 language tag | `en` | Locale for date formatting in rendered output |
| `owner` | string | — | Default assignee for tasks without `@` field |
| `version` | string | — | Free-form version label for the plan |

**Example:**

```
title: Platform Migration Q1
start: 2026-01-12
end: 2026-03-31
schedule: business-days
timezone: America/New_York
locale: en-US
owner: @team-lead
version: 1.3
```

All header fields are optional. A file with no header is valid; scheduling begins from today using calendar days.

---

## 3. Line Classification Rules

The parser classifies each non-empty line by testing the following conditions in order. The first match wins.

| Priority | Pattern | Classification |
|---|---|---|
| 1 | Starts with `//` | Comment — ignored |
| 2 | Matches `key: value` and is in the header zone | Header field |
| 3 | Starts with `#` (followed by space or end of line) | Section header |
| 4 | Starts with `>>` | Milestone |
| 5 | Starts with `parallel:` | Parallel block open |
| 6 | Starts with `end:` | Parallel block close |
| 7 | Starts with `*` | Recurring task |
| 8 | Starts with one or more `.` followed by a space and `[` | Subtask |
| 9 | Starts with `[` | Task |
| 10 | Blank line | Ignored |
| 11 | Any other content | Parse warning; line skipped |

The "header zone" ends as soon as the parser encounters any non-header-field, non-blank, non-comment line.

---

## 4. Task Line Anatomy

A task line has two parts: a **status+name prefix** and an optional **pipe-field list**.

```
[status] Task name | field | field | field ...
```

### 4.1 Status+Name Prefix

```
[status] Task name
```

- The status token is enclosed in square brackets with no internal spaces around the sigil character (e.g., `[~]` not `[ ~ ]`). Both short sigil form and long word form are valid (see Section 5).
- The task name is everything after the closing `]` up to the first `|` character (or end of line), trimmed of leading and trailing whitespace.
- Task names may contain any Unicode character except `|`.

### 4.2 Pipe-Field List

After the task name, zero or more fields follow, each preceded by `|`. Field order is not significant. Fields are identified by their leading sigil character or keyword prefix.

```
[~] Refactor auth module | 5d | @alice | #backend | !high | %40 | id:auth-refactor | after:db-upgrade | +at-risk | >2026-02-01 | <2026-02-28 | $JIRA-991
```

See Section 6 for the complete field reference.

---

## 5. Status Vocabulary

Both sigil form and word form are accepted by the parser. Renderers use word form internally.

| Sigil | Word | Meaning | Lifecycle Notes |
|---|---|---|---|
| `[ ]` | `new` | Not started | Default for unbegun work |
| `[~]` | `active` | In progress | Should have `%progress` |
| `[x]` | `done` | Completed | Duration is historical; not projected |
| `[!]` | `blocked` | Blocked | Scheduling continues past blocked tasks unless `+hard-block` modifier present |
| `[?]` | `at-risk` | At risk | Scheduled normally; visual warning |
| `[>]` | `deferred` | Deferred/postponed | Excluded from sequential scheduling chain; treated as zero-duration for dependency resolution |
| `[_]` | `cancelled` | Cancelled | Excluded from scheduling entirely; dependencies skip over cancelled tasks |
| `[=]` | `review` | In review/awaiting approval | Scheduled normally |
| `[o]` | `paused` | Paused | Holds its start date; duration continues from resume |

### 5.1 Scheduling Effects

- `done`, `active`, `new`, `review`, `at-risk`, `paused`, `blocked` — participate in sequential scheduling chain.
- `deferred` — skipped in the sequential chain (the next task starts at the same time the deferred task would have started). Deferred tasks are still rendered but greyed out.
- `cancelled` — fully excluded. Downstream `after:` references to a cancelled task resolve to that task's scheduled start date (not end date), preventing indefinite blocking.

---

## 6. Field Reference

Fields appear in the pipe-delimited list after the task name. Multiple fields of the same type on one line produce a parse warning; the last value wins.

| Sigil | Name | Type | Example | Notes |
|---|---|---|---|---|
| (no sigil, parseable as duration) | duration | duration string | `3d`, `2bd`, `1w` | See Section 7. If absent, defaults to `1d`. |
| `@` | assignee | string | `@alice`, `@team-alpha` | Multiple allowed: `@alice @bob` (space-separated within the field) or separate `@` fields |
| `#` | tag | string | `#backend`, `#ux` | Multiple allowed as separate fields |
| `!` | priority | `critical` \| `high` \| `medium` \| `low` | `!high` | Default: `medium` |
| `%` | progress | integer 0–100 | `%40` | Used by renderer for fill bar |
| `id:` | task ID | slug | `id:auth-refactor` | Must be unique within document |
| `after:` | dependency | ID list | `after:task-a,task-b` | AND logic. `after:a\|b` for OR logic |
| `+` | modifier | modifier keyword | `+deadline`, `+external` | See Section 14 |
| `>` | start date | ISO date | `>2026-03-01` | Overrides computed start; task cannot start before this date |
| `<` | due date | ISO date | `<2026-03-31` | Soft deadline; triggers warning if scheduled end exceeds this |
| `$` | ticket reference | string | `$JIRA-1042`, `$GH-99` | Opaque; rendered as a link if URL template configured |

### 6.1 Multiple Assignees

```
[~] Design review | 2d | @alice @bob | #design
```

Space-separated handles within a single `@` field are all valid. Alternatively:

```
[~] Design review | 2d | @alice | @bob | #design
```

Both forms produce the same result.

---

## 7. Duration Grammar

### 7.1 Unit Tokens

| Suffix | Meaning | Business-Day Semantics |
|---|---|---|
| `h` | Hours | Calendar hours only; does not respect `schedule` setting |
| `d` | Days | Calendar days unless `schedule: business-days` is set |
| `bd` | Business days | Always business days regardless of `schedule` setting |
| `w` | Weeks | Always 7 calendar days (= 5bd if `schedule: business-days`) |
| `m` | Months | Calendar months (28–31 days depending on month) |
| `q` | Quarters | 3 calendar months |

### 7.2 Business Days

Business days are Monday through Friday, excluding no holidays by default. A future `holidays` header field will allow specifying a holiday calendar. The `bd` suffix always means business days. The bare `d` suffix follows the document's `schedule` setting.

### 7.3 Duration Format

A duration token is a positive number (integer or decimal) followed immediately by a unit suffix, with no space.

```
3d    5bd    2w    1.5h    0.5m    1q
```

Decimal durations are valid. `1.5d` means one and a half days (36 calendar hours).

### 7.4 Compound Durations

Compound durations are not supported in v0.1.0. `2w3d` is a parse error. Use the most appropriate single unit or convert manually.

---

## 8. Date Expressions

### 8.1 ISO Dates

All absolute dates use ISO 8601 format: `YYYY-MM-DD`. Partial dates (`2026-03`) are not supported.

### 8.2 Start Date Override (`>`)

```
>2026-03-01
```

The `>` field sets the earliest possible start date for the task. If the sequentially computed start date is already later than this date, the override has no effect. If the computed start is earlier, the task is pushed forward to the specified date (introducing a gap in the schedule).

### 8.3 Due Date (`<`)

```
<2026-03-31
```

The `<` field sets a soft deadline. The parser and renderer use this to flag overruns visually. It does not affect scheduling computations unless the `+deadline` modifier is also present (see Section 14).

### 8.4 Milestone Date (`>>` with `>`)

On milestone lines, the `>` field sets the milestone's exact date:

```
>> Go-live | >2026-04-01 | +deadline | id:go-live
```

If the `>` field is absent from a milestone line, the milestone's date is computed as the end of the preceding sequential chain.

---

## 9. Sequential Scheduling Model

### 9.1 Default Behavior

Tasks in a YATT document are scheduled sequentially. Task N starts on the day after Task N−1 ends, subject to the document's `schedule` setting (calendar vs. business days for gaps).

The first task starts on the document `start` date.

### 9.2 Override Precedence

The following rules are applied in order to determine a task's start date:

1. If the task has `after:` dependencies, its start date is the maximum end date of all resolved dependencies (AND) or the minimum end date (OR). This supersedes sequential position.
2. If the task has a `>start-date` field, its start date is the later of the computed dependency date and the specified date.
3. Otherwise, the task starts immediately after the preceding task in document order ends.

### 9.3 Skipped Statuses

Tasks with status `deferred` or `cancelled` are skipped in sequential chaining. The task immediately following a deferred or cancelled task starts at the same date that the skipped task would have started.

### 9.4 Done Tasks

Completed (`done`) tasks use their duration as historical. Their end date is computed identically to active/new tasks — `start + duration`. This means done tasks still occupy their slot in the schedule. Renderers may style them differently (filled bar, strikethrough) but they are not removed from the timeline.

### 9.5 Gaps and Overlaps

A `>start-date` override may introduce a gap between tasks (the preceding task ends before the override date). Gaps are valid and rendered as empty space. There is no "overlap" concept in sequential mode; tasks do not overlap unless they are in separate parallel blocks.

---

## 10. Parallel Blocks

### 10.1 Syntax

```
parallel: blockname | after:other-block | >start-date
[~] Task one  | 3d | @alice | id:task-one
[ ] Task two  | 2d | @bob
end: blockname
```

A `parallel:` line opens a named block. All tasks between `parallel:` and the matching `end:` are considered members of that block. The block name is its implicit ID for `after:` references.

### 10.2 Block Scheduling

- All tasks within a block are scheduled sequentially by default (relative to each other), starting at the block's own start date.
- The block itself starts at the end of the preceding sequential element (the same rules as a regular task), unless overridden by `after:` or `>` on the `parallel:` line.
- Multiple parallel blocks that open at the same point in the document run concurrently with respect to the outer sequential chain.

### 10.3 Block Completion Semantics

When another task or block uses `after:blockname`, the resolved date is the **end of the last task in that block** — i.e., the latest end date among all tasks that are members of that block (accounting for their own sequential chains within the block).

### 10.4 Nested Blocks

Nested `parallel:` blocks are not supported in v0.1.0.

### 10.5 Tasks Outside Blocks

Tasks appearing in the outer (top-level) sequential chain are not affected by parallel blocks except through explicit `after:` references. A task that appears in document order after an `end:` line is scheduled after the end of... the preceding sequential element — which may or may not be the parallel block, depending on document structure.

To explicitly sequence the outer chain after a parallel block, use `after:blockname` on the downstream task:

```
parallel: phase-a
[~] Work A | 3d
end: phase-a

parallel: phase-b
[ ] Work B | 2d
end: phase-b

[ ] Integration | 2d | after:phase-a,phase-b
```

---

## 11. Task IDs and Dependencies

### 11.1 The `id:` Field

```
id:my-task-slug
```

Task IDs are slugs: lowercase letters, digits, and hyphens. No spaces. IDs must be unique within a document. Duplicate IDs produce a parse error.

Block names (from `parallel:` lines) occupy the same namespace as task IDs. A block named `frontend` conflicts with a task with `id:frontend`.

### 11.2 Auto-IDs

Tasks without an explicit `id:` field do not have an addressable ID and cannot be referenced by `after:`. A future version may introduce auto-generated positional IDs.

### 11.3 Subtask IDs

Subtasks may have their own `id:` fields:

```
[~] Parent task | 5d | id:parent
.  [~] Child one | 2d | id:child-one
.  [ ] Child two | 3d | id:child-two | after:child-one
```

Subtask IDs are in the same document-global namespace as top-level task IDs.

### 11.4 `after:` AND Logic

```
after:task-a,task-b
```

Comma-separated IDs express AND logic: the task starts after **all** listed dependencies have ended.

### 11.5 `after:` OR Logic

```
after:task-a|task-b
```

Pipe-separated IDs express OR logic: the task starts after **any one** of the listed dependencies has ended (i.e., the minimum end date).

### 11.6 Mixed AND/OR

AND and OR cannot be mixed on the same `after:` field in v0.1.0. Use separate `after:` fields or restructure with an intermediate task.

### 11.7 Cycle Detection

The parser performs cycle detection after resolving all `after:` references. A circular dependency (task A depends on task B which depends on task A) produces a parse error listing the cycle members. Deferred and cancelled tasks are excluded from cycle detection.

---

## 12. Subtask Dot Notation

### 12.1 Depth Levels

Subtasks are indicated by leading dots before the `[status]` token:

| Prefix | Depth | Maximum Nesting |
|---|---|---|
| `.` (one dot + space) | Level 1 | Under any top-level task |
| `..` (two dots + space) | Level 2 | Under a Level 1 subtask |
| `...` (three dots + space) | Level 3 | Under a Level 2 subtask |

Depth beyond Level 3 is not supported in v0.1.0.

### 12.2 Syntax

```
[~] Parent task | 5d | @alice | id:parent
.  [x] Research    | 1d | @alice | %100
.  [~] Implement   | 3d | @alice | %40 | id:parent-impl
.. [x] Unit tests  | 1d | @alice | %100
.. [ ] Integration | 1d | @alice | after:parent-impl
.  [ ] Review      | 1d | @alice
```

### 12.3 Subtask Scheduling

Subtasks within a parent are scheduled sequentially relative to each other, starting at the parent's start date. The parent's duration, if explicitly specified, is the authoritative duration for scheduling purposes. If the parent has no explicit duration, it is computed as the sum of its subtasks' durations.

### 12.4 Progress Rollup

If a parent task has no explicit `%progress` field, its progress is computed as the weighted average of subtask progress values, weighted by duration. If a parent has an explicit `%` field, that value takes precedence over rollup.

---

## 13. Milestones

### 13.1 Syntax

```
>> Milestone name | >2026-03-15 | +deadline | id:milestone-slug
```

The `>>` prefix designates a milestone. Milestones have zero duration and appear as a point on the Gantt timeline.

### 13.2 Date Behavior

- If a `>date` field is present, the milestone is pinned to that date.
- If no `>date` field is present, the milestone date is computed as the end of the preceding sequential element (the same as a zero-duration task).

### 13.3 Milestone Fields

Milestones accept a subset of task fields:

| Field | Supported | Notes |
|---|---|---|
| `>date` | Yes | Pins the milestone to an absolute date |
| `id:` | Yes | Makes the milestone addressable as a dependency |
| `+modifier` | Yes | `+deadline` and `+fixed` are most common |
| `@assignee` | Yes | Optional owner |
| `#tag` | Yes | Optional tag |
| `after:` | Yes | Milestone waits for dependencies before being placed |
| `duration` | No | Always zero |
| `%progress` | No | Not applicable |

### 13.4 Participation in Sequential Chain

A milestone participates in the sequential chain like any other element. A task following a milestone in document order starts on the milestone's date (zero duration means start and end are the same day).

---

## 14. Modifier System

Modifiers are `+keyword` fields that attach semantic flags to tasks, milestones, or blocks. They affect rendering and may affect scheduling.

| Modifier | Applies To | Scheduling Effect | Rendering Effect |
|---|---|---|---|
| `+deadline` | Task, Milestone | If combined with `<due-date`, scheduler emits overrun error if computed end > due date | Red diamond or flag on Gantt |
| `+fixed` | Task, Milestone | Pins the task to its `>start-date`; no upstream dependency can push it later | Hatched bar; lock icon |
| `+external` | Task | No scheduling effect | Different bar color (e.g., orange); indicates third-party or vendor dependency |
| `+waiting` | Task | No scheduling effect | Waiting/clock icon; indicates task is blocked on external response |
| `+at-risk` | Task | No scheduling effect | Yellow warning icon |
| `+blocked` | Task | No scheduling effect | Red blocked icon (same as `[!]` status but usable on any status) |
| `+critical` | Task | No scheduling effect | Bold red bar; marks critical path membership |
| `+tentative` | Task, Milestone | No scheduling effect | Dashed bar or diamond outline |
| `+recurring` | Task | No scheduling effect | Repeat icon; used by renderer when `*` prefix is present |
| `+milestone` | Task | Treats task as zero-duration milestone | Same as `>>` rendering |

### 14.1 Modifier Combinations

Multiple modifiers are allowed on one task:

```
[ ] Vendor delivery | 5d | @supplier | +external | +fixed | >2026-03-10 | <2026-03-10
```

---

## 15. Recurring Tasks

### 15.1 Syntax

```
*daily   Standup             | 15m | @team   | #ceremony
*weekly  Sprint planning     | 2h  | @team   | #ceremony
*biweekly  Architecture sync | 1h  | @leads  | id:arch-sync
*monthly   Stakeholder review | 2h  | @pm
*quarterly Business review   | 3h  | @exec
```

The `*` prefix followed immediately by a recurrence token designates a recurring task.

### 15.2 Recurrence Tokens

| Token | Frequency |
|---|---|
| `daily` | Every calendar day |
| `weekday` | Every business day (Mon–Fri) |
| `weekly` | Once per week (same day as `start`) |
| `biweekly` | Every two weeks |
| `monthly` | Once per calendar month |
| `quarterly` | Once per quarter |

### 15.3 Rendering

Recurring tasks are rendered as repeating blocks across the timeline for the duration of the document's date range. They do not participate in the sequential scheduling chain and do not affect the start dates of other tasks. They appear as a separate "ceremonies" lane or as thin repeating bars depending on renderer configuration.

---

## 16. Sections

### 16.1 Syntax

```
# Section Name
```

A `#` followed by a space and a name creates a section header. Section headers are purely organizational; they have no effect on scheduling, dependencies, or the sequential chain. Tasks in different sections are scheduled continuously as if the section headers were not present.

### 16.2 Purpose

Sections group tasks visually in both the plain-text source and in rendered output. A renderer may draw a horizontal divider and section label on the Gantt chart.

### 16.3 Nesting

Section nesting (e.g., `##`) is not supported in v0.1.0. All sections are at the same hierarchical level.

---

## 17. Comments

```
// This is a comment
```

Any line beginning with `//` is a comment and is entirely ignored by the parser. Comments may appear anywhere in the document, including within parallel blocks and the header zone.

Inline comments (partial-line comments) are not supported. A `//` sequence within a task name or field value is treated as literal characters.

---

## 18. Formal Grammar

The following is a PEG-style sketch of the YATT grammar. This is informative, not normative.

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
Section        <- "#" SP Name NL
Name           <- (!NL .)+

Milestone      <- ">>" SP Name PipeFields? NL

ParallelOpen   <- "parallel:" SP BlockName PipeFields? NL
ParallelClose  <- "end:" SP BlockName NL
BlockName      <- [a-z0-9-]+

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
               / ProgressField / IdField / AfterField / ModifierField
               / StartDateField / DueDateField / TicketField

DurationField  <- NUMBER ("h" / "bd" / "d" / "w" / "m" / "q")
AssigneeField  <- "@" [a-zA-Z0-9_-]+ (SP "@" [a-zA-Z0-9_-]+)*
TagField       <- "#" [a-zA-Z0-9_-]+
PriorityField  <- "!" ("critical" / "high" / "medium" / "low")
ProgressField  <- "%" [0-9]+ ("%"?)
IdField        <- "id:" Slug
AfterField     <- "after:" Slug ("," Slug)* / "after:" Slug ("|" Slug)*
ModifierField  <- "+" ModifierWord
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

## 19. Rendering Model

### 19.1 Gantt Chart Structure

A rendered YATT document produces a horizontal Gantt chart with:

- A date axis along the top (or bottom), scaled to the document's full date range.
- One row per task, subtask, and milestone.
- Section headers rendered as divider rows.
- Parallel blocks optionally grouped visually.

### 19.2 Bar Colors by Status

| Status | Suggested Color | Notes |
|---|---|---|
| `new` | Steel blue | Default unstarted bar |
| `active` | Blue | Filled to `%progress` |
| `done` | Green | Fully filled |
| `blocked` | Red | Striped or solid red |
| `at-risk` | Yellow/amber | Warning stripe |
| `deferred` | Grey | Semi-transparent or dashed |
| `cancelled` | Light grey | Crossed out |
| `review` | Purple/violet | Awaiting approval |
| `paused` | Orange | Paused indicator |

### 19.3 Progress Fill

For tasks with `%progress`, the bar is split: the filled portion (up to `%` of the bar width) uses the primary status color; the remainder uses a lighter tint. A `%0` task shows an empty bar in status color. A `%100` task should automatically use `done` rendering.

### 19.4 Modifiers in Rendering

- `+deadline`: Add a red flag or diamond marker at the due date.
- `+fixed`: Add a lock icon or hatched fill to the bar.
- `+external`: Use an orange or teal bar variant.
- `+critical`: Bold bar outline or bright red fill.
- `+tentative`: Dashed border.

### 19.5 Milestones in Rendering

Milestones are rendered as a diamond shape (◆) at their date. The `+deadline` modifier colors the diamond red. The `+fixed` modifier adds a lock.

### 19.6 Suggested Rendering Behaviors

- Today line: a vertical dashed line at the current date.
- Overrun highlight: if a task's computed end date exceeds its `<due-date`, shade the overrun portion in red.
- Dependency arrows: optional connector lines from dependency end to dependent start; off by default for readability.
- Assignee avatars: small avatar or initial badge on bars when `@assignee` is present.
- Hover tooltips: on interactive renderers, hovering a bar shows all field values.

---

## 20. Version History

| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-24 | Initial specification. Core task syntax, parallel blocks, dependencies, subtasks, milestones, modifiers, recurring tasks. |

---

*End of YATT Specification v0.1.0*
