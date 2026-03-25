import { YattDocument, ParseError, Task, Milestone, ParallelBlock, DocumentItem } from './types.js';

export function validate(doc: YattDocument): ParseError[] {
  const errors: ParseError[] = [];

  // Collect all tasks and milestones for analysis
  const allSchedulable: Array<Task | Milestone> = [];

  function collectItems(items: Array<DocumentItem | Task | Milestone>) {
    for (const item of items) {
      if (item.type === 'task') {
        allSchedulable.push(item);
        collectItems(item.subtasks);
      } else if (item.type === 'milestone') {
        allSchedulable.push(item);
      } else if (item.type === 'parallel') {
        collectItems(item.items as Array<DocumentItem>);
      }
    }
  }
  collectItems(doc.items);

  // ── ID uniqueness: already handled in parser pass 1, but re-check ─────────
  // (idMap was built with dedup errors, so we trust those)

  // ── Validate after: references exist ─────────────────────────────────────
  for (const item of allSchedulable) {
    for (const dep of item.after) {
      for (const id of dep.ids) {
        if (!doc.idMap.has(id)) {
          errors.push({
            message: `Reference to unknown ID "${id}"`,
            line: item.line,
            severity: 'error',
          });
        }
      }
    }
  }

  // ── Progress/status consistency ───────────────────────────────────────────
  for (const item of allSchedulable) {
    if (item.type === 'task') {
      if (item.progress === 100 && item.status !== 'done') {
        errors.push({
          message: `Task "${item.name}" has 100% progress but status is not "done"`,
          line: item.line,
          severity: 'warning',
        });
      }
      if (item.status === 'done' && item.progress !== undefined && item.progress < 100) {
        errors.push({
          message: `Task "${item.name}" has status "done" but progress is ${item.progress}%`,
          line: item.line,
          severity: 'warning',
        });
      }
    }
  }

  // ── Deferred/cancelled tasks with after: dependencies ────────────────────
  for (const item of allSchedulable) {
    if (item.type === 'task') {
      if ((item.status === 'deferred' || item.status === 'cancelled') && item.after.length > 0) {
        errors.push({
          message: `Task "${item.name}" is ${item.status} but has dependency constraints`,
          line: item.line,
          severity: 'warning',
        });
      }
    }
  }

  // ── Cycle detection via Kahn's algorithm ──────────────────────────────────
  // Build adjacency list: id → ids that depend on it (reverse: who I must come after)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // id → list of ids that depend on id

  // Only consider items with IDs
  for (const [id] of doc.idMap) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  function addDepsForItem(item: Task | Milestone) {
    if (!item.id) return;
    for (const dep of item.after) {
      for (const depId of dep.ids) {
        if (!doc.idMap.has(depId)) continue;
        // item.id depends on depId: edge depId → item.id
        dependents.get(depId)?.push(item.id);
        inDegree.set(item.id, (inDegree.get(item.id) ?? 0) + 1);
      }
    }
  }

  for (const item of allSchedulable) {
    addDepsForItem(item);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const dependent of (dependents.get(current) ?? [])) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (processed < inDegree.size) {
    // There's a cycle — find which IDs are involved
    const cycleIds = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([id]) => id);
    errors.push({
      message: `Dependency cycle detected among: ${cycleIds.join(', ')}`,
      line: 0,
      severity: 'error',
    });
  }

  return errors;
}
