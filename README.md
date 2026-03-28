# YATT — Yet Another Task Tracker

**Markdown is the database. Git is the history. YATT is the UI.**

YATT is a plain-text task tracker that lives inside your Markdown files. Tasks are written in a simple one-line format — status, name, duration, assignee, tags — and YATT renders them as a Gantt timeline, Kanban board, or people view. Because everything is text, your whole team can edit tasks in any editor, review changes in pull requests, and get a full audit trail from git for free.

![build](https://img.shields.io/badge/build-passing-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## Why YATT?

Most task trackers store data in a database you can't read or diff. YATT flips this: **the `.md` file is the source of truth.** This means:

- **Git-native** — every task change is a commit. Branch for experiments, merge to ship, revert mistakes.
- **No lock-in** — your tasks are plain text. Open them in Vim, VS Code, Obsidian, or cat them in a terminal.
- **Team-friendly** — pull requests *are* planning reviews. Comment on task lines, suggest changes, approve.
- **Offline-first** — nothing to sync. The file is always up to date.
- **Lightweight server** — run `yatt serve` to get a live Gantt, Kanban, and People view. Commit and push without leaving the browser.

---

## What it looks like

![YATT timeline view](./examples/showcase.svg)

```yatt
title: Product v2 Launch
start: 2026-01-05

[x] Discovery & planning | id:phase1 | 5d | @alice | delayed 3d
// Research took longer than expected — scope was broader than estimated.
>> Kickoff complete | after:phase1

parallel: design | after:phase1
[done] UX wireframes  | 4d | @carol | %100
[~]    Visual design  | 3d | @carol | %80 | delayed 2d
end: design

parallel: engineering | after:phase1
[x] API scaffold  | id:api | 3d | @bob | blocked 1w | delayed 2d
[ ] Auth service  | 4d | @bob   | after:api | %45
[ ] Core features | 1w | @alice | after:api
end: engineering

[ ] Integration & QA | id:qa | 5d | @alice @bob | after:design,engineering
>> v2.0 Release      | after:qa | +deadline
```

Tasks render as a minimal **line + circle** timeline — a filled dot at start, hollow ring at end, bright leading segment for progress. Milestones are bullseye circles. Hover any row for a details card.

---

## Quick start

```bash
# Serve a folder of Markdown files
npx yatt serve ./docs

# Or install globally
npm install -g yatt
yatt serve .
```

Open `http://localhost:3000`. Pick any `.md` file from the sidebar. YATT finds all ` ```yatt ` blocks in the file and renders them.

The **Edit** tab lets you write raw YATT syntax. Changes save automatically and the view updates live.

---

## Task syntax

One task per line:

```
[status] Task name | duration | @assignee | #tag | %progress | id:slug | after:dep
// Optional description — attach one or more comment lines immediately after a task
```

**Status sigils:**

| Sigil | Word | Meaning |
|---|---|---|
| `[ ]` | `[new]` | Not started |
| `[~]` | `[active]` | In progress |
| `[=]` | `[review]` | In review |
| `[!]` | `[blocked]` | Blocked |
| `[o]` | `[paused]` | Paused |
| `[x]` | `[done]` | Complete |
| `[_]` | `[cancelled]` | Cancelled |

**Other syntax:**

```
>> Milestone name | after:id | +deadline   ← milestone; +deadline draws a full-height line
parallel: name                              ← parallel block start
end: name                                  ← parallel block end
[ ] Task | blocked 2w                      ← externally blocked for 2 weeks (red ghost)
[ ] Task | delayed 3d                      ← running 3 days late (orange overrun)
[ ] Task | 5bd                             ← 5 business days
[ ] Task | 2026-04-01                      ← fixed start date
[ ] Task | !high                           ← priority: low / normal / high / critical
```

---

## The server

```bash
yatt serve [folder] [--port 3000]
```

Four views, switchable by tab:

| View | What you see |
|---|---|
| **Timeline** | Minimal Gantt — lines and circles, hover for details |
| **Kanban** | Columns by status; drag to reassign; empty columns collapse to slim strips |
| **People** | Tasks grouped by assignee |
| **Edit** | Raw YATT source with live save |

Click any task in any view to open the **edit modal** — change status, assignees, dates, priority, delayed/blocked duration, and description.

### Git integration

The top bar shows your current branch and sync state. No terminal needed for day-to-day use:

- **Pull** — fetch and merge the latest from remote
- **Commit** — stages everything (`git add -A`) and commits with your message
- **Push** — pushes to remote

Merge conflicts and auth are left to the CLI — YATT surfaces the error and tells you to resolve from the terminal.

---

## Key features

- **Descriptions** — `//` comment lines immediately after a task become its description (shown in hover card and list view)
- **Dependencies** — `after:a,b` (AND), `after:a|b` (OR), cross-block by ID
- **Parallel workstreams** — `parallel: name` … `end: name`
- **Subtasks** — leading `.` or `..` (sequential within parent)
- **Progress** — `%60` renders as a bright leading segment on the timeline bar
- **Delayed / blocked** — `delayed 3d` extends the end; `blocked 2w` shifts the start; both show ghost indicators
- **Business days** — `5bd` or header `schedule: business-days`
- **Milestones** — `>> name | +deadline`

---

## Examples

| File | Description |
|---|---|
| [01-hello-world.md](./examples/01-hello-world.md) | Simplest chart — sequential tasks with descriptions |
| [02-team-sprint.md](./examples/02-team-sprint.md) | Sprint with statuses, assignees, priorities, dependencies |
| [03-product-launch.md](./examples/03-product-launch.md) | Phased launch with milestones, subtasks, cross-phase deps |
| [04-parallel-workstreams.md](./examples/04-parallel-workstreams.md) | Multiple workstreams converging on shared milestones |
| [05-enterprise-program.md](./examples/05-enterprise-program.md) | Full-scale program — all features combined |
| [06-delays-and-blocks.md](./examples/06-delays-and-blocks.md) | `delayed X` and `blocked X` with ghost indicators |

---

## Documentation

- [SPEC.md](./SPEC.md) — Full language reference

---

## License

MIT
