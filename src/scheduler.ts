import {
  YattDocument, Task, Milestone, ParallelBlock, DocumentItem, Duration, Dependency,
} from './types.js';

// ── Date arithmetic ───────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d;
}

function isWeekend(date: Date, weekStart: 'mon' | 'sun' = 'mon'): boolean {
  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  if (weekStart === 'sun') {
    // If week starts Sunday, Fri(5) and Sat(6) are weekend
    return dow === 5 || dow === 6;
  }
  // Standard Mon-Sun week: Sat(6) and Sun(0)
  return dow === 0 || dow === 6;
}

function addBusinessDays(date: Date, days: number, weekStart: 'mon' | 'sun' = 'mon'): Date {
  let d = new Date(date);
  let remaining = Math.round(days);
  const sign = remaining >= 0 ? 1 : -1;
  remaining = Math.abs(remaining);

  while (remaining > 0) {
    d = addDays(d, sign);
    if (!isWeekend(d, weekStart)) {
      remaining--;
    }
  }
  return d;
}

function addDuration(start: Date, duration: Duration, useBusinessDays: boolean, weekStart: 'mon' | 'sun' = 'mon'): Date {
  const { value, unit } = duration;
  switch (unit) {
    case 'h': {
      const ms = value * 60 * 60 * 1000;
      return new Date(start.getTime() + ms);
    }
    case 'd':
      return addDays(start, value);
    case 'bd':
      return addBusinessDays(start, value, weekStart);
    case 'w':
      return addDays(start, value * 7);
    case 'm': {
      const d = new Date(start);
      d.setUTCMonth(d.getUTCMonth() + value);
      return d;
    }
    case 'q': {
      const d = new Date(start);
      d.setUTCMonth(d.getUTCMonth() + value * 3);
      return d;
    }
    default:
      return addDays(start, value);
  }
}

function parseDate(s: string): Date {
  // Parse ISO date as UTC midnight
  return new Date(s + 'T00:00:00Z');
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

// ── Scheduling context ────────────────────────────────────────────────────────

interface ScheduleCtx {
  projectStart: Date;
  useBusinessDays: boolean;
  weekStart: 'mon' | 'sun';
  idMap: Map<string, Task | Milestone | ParallelBlock>;
}

function resolvedEnd(id: string, ctx: ScheduleCtx): Date | undefined {
  const item = ctx.idMap.get(id);
  if (!item) return undefined;
  if (item.type === 'task') return item.computedEnd;
  if (item.type === 'milestone') return item.computedDate;
  if (item.type === 'parallel') return item.computedEnd;
  return undefined;
}

function computeStartFromDeps(after: Dependency[], ctx: ScheduleCtx): Date | undefined {
  if (after.length === 0) return undefined;

  let result: Date | undefined;

  for (const dep of after) {
    let depDate: Date | undefined;
    if (dep.logic === 'and') {
      // AND: max of all referenced ends
      for (const id of dep.ids) {
        const end = resolvedEnd(id, ctx);
        if (end) depDate = depDate ? maxDate(depDate, end) : end;
      }
    } else {
      // OR: min of all referenced ends
      for (const id of dep.ids) {
        const end = resolvedEnd(id, ctx);
        if (end) depDate = depDate ? minDate(depDate, end) : end;
      }
    }
    if (depDate) result = result ? maxDate(result, depDate) : depDate;
  }

  return result;
}

function scheduleTask(task: Task, sequentialAnchor: Date, ctx: ScheduleCtx): void {
  const isFixed = task.modifiers.includes('fixed') && task.startDate;
  let start: Date;

  if (isFixed && task.startDate) {
    start = parseDate(task.startDate);
  } else {
    const depStart = computeStartFromDeps(task.after, ctx);

    if (task.after.length > 0) {
      // after: overrides sequential default
      start = depStart ?? sequentialAnchor;
    } else {
      start = sequentialAnchor;
    }

    // Explicit startDate acts as a floor (unless +fixed already handled)
    if (task.startDate) {
      const explicit = parseDate(task.startDate);
      start = maxDate(start, explicit);
    }
  }

  task.computedStart = start;

  if (task.duration) {
    const bd = task.duration.unit === 'bd' || ctx.useBusinessDays;
    task.computedEnd = addDuration(start, task.duration, bd, ctx.weekStart);
  } else {
    // No duration: point in time (same as start)
    task.computedEnd = new Date(start);
  }

  // Schedule subtasks sequentially within the task
  let subAnchor = start;
  for (const sub of task.subtasks) {
    scheduleTask(sub, subAnchor, ctx);
    if (sub.computedEnd && sub.status !== 'deferred' && sub.status !== 'cancelled') {
      subAnchor = sub.computedEnd;
    }
  }

  // Extend parent's end to cover all subtasks
  if (task.subtasks.length > 0) {
    for (const sub of task.subtasks) {
      if (sub.computedEnd) {
        task.computedEnd = task.computedEnd
          ? maxDate(task.computedEnd, sub.computedEnd)
          : sub.computedEnd;
      }
    }
  }
}

function scheduleMilestone(ms: Milestone, sequentialAnchor: Date, ctx: ScheduleCtx): void {
  const depStart = computeStartFromDeps(ms.after, ctx);
  let date: Date;

  if (ms.after.length > 0) {
    date = depStart ?? sequentialAnchor;
  } else {
    date = sequentialAnchor;
  }

  if (ms.date) {
    const explicit = parseDate(ms.date);
    date = maxDate(date, explicit);
  }

  ms.computedDate = date;
}

function scheduleBlock(block: ParallelBlock, sequentialAnchor: Date, ctx: ScheduleCtx): void {
  const depStart = computeStartFromDeps(block.after, ctx);
  const blockStart = depStart ? maxDate(depStart, sequentialAnchor) : sequentialAnchor;

  block.computedStart = blockStart;

  // Within block: sequential among items
  let innerAnchor = blockStart;
  for (const item of block.items) {
    if (item.type === 'task') {
      scheduleTask(item, innerAnchor, ctx);
      if (item.computedEnd && item.status !== 'deferred' && item.status !== 'cancelled') {
        innerAnchor = item.computedEnd;
      }
    } else if (item.type === 'milestone') {
      scheduleMilestone(item, innerAnchor, ctx);
      if (item.computedDate) innerAnchor = item.computedDate;
    } else if (item.type === 'parallel') {
      scheduleBlock(item, innerAnchor, ctx);
      // Nested parallel blocks don't advance the inner anchor either.
    }
  }

  // Block's end = max of all children's ends
  let blockEnd: Date | undefined;
  for (const item of block.items) {
    let itemEnd: Date | undefined;
    if (item.type === 'task') itemEnd = item.computedEnd;
    else if (item.type === 'milestone') itemEnd = item.computedDate;
    else if (item.type === 'parallel') itemEnd = item.computedEnd;

    if (itemEnd) blockEnd = blockEnd ? maxDate(blockEnd, itemEnd) : itemEnd;
  }

  block.computedEnd = blockEnd ?? blockStart;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function schedule(doc: YattDocument): YattDocument {
  const projectStart = doc.header.start
    ? parseDate(doc.header.start)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const useBusinessDays = doc.header.schedule === 'business-days';
  const weekStart = doc.header.weekStart ?? 'mon';

  const ctx: ScheduleCtx = {
    projectStart,
    useBusinessDays,
    weekStart,
    idMap: doc.idMap,
  };

  let sequentialAnchor = projectStart;

  for (const item of doc.items) {
    if (item.type === 'task') {
      scheduleTask(item, sequentialAnchor, ctx);
      if (item.computedEnd && item.status !== 'deferred' && item.status !== 'cancelled') {
        sequentialAnchor = item.computedEnd;
      }
    } else if (item.type === 'milestone') {
      scheduleMilestone(item, sequentialAnchor, ctx);
      if (item.computedDate) sequentialAnchor = item.computedDate;
    } else if (item.type === 'parallel') {
      scheduleBlock(item, sequentialAnchor, ctx);
      // Parallel blocks do NOT advance the sequential anchor.
      // Multiple parallel blocks all start at the same anchor point.
      // Use after: on a subsequent item to explicitly depend on a block finishing.
    }
    // sections/comments don't affect scheduling
  }

  return doc;
}
