import { tokenize, Token } from './lexer.js';
import {
  YattDocument, YattHeader, DocumentItem, Task, Milestone, ParallelBlock,
  Section, Comment, ParseError, Status, Priority, Duration, DurationUnit, Dependency,
} from './types.js';

// ── Status maps ──────────────────────────────────────────────────────────────

const SIGIL_TO_STATUS: Record<string, Status> = {
  ' ': 'new',
  '~': 'active',
  'x': 'done',
  '!': 'blocked',
  '?': 'at-risk',
  '>': 'deferred',
  '_': 'cancelled',
  '-': 'cancelled',
  '=': 'review',
  'o': 'paused',
};

const WORD_TO_STATUS: Record<string, Status> = {
  new: 'new',
  active: 'active',
  done: 'done',
  blocked: 'blocked',
  'at-risk': 'at-risk',
  deferred: 'deferred',
  cancelled: 'cancelled',
  review: 'review',
  paused: 'paused',
};

// ── Regex patterns ────────────────────────────────────────────────────────────

const RE_DURATION = /^(\d+(?:\.\d+)?)(h|bd|d|w|m|q)$/;
const RE_ASSIGNEE = /^@[\w-]+/g;
const RE_PRIORITY = /^!(high|critical|low|normal)$/;
const RE_PROGRESS = /^%(\d+)$/;
const RE_ID = /^id:([\w-]+)$/;
const RE_HASH_ID = /^#([\w-]+)$/;
const RE_AFTER = /^after:([\w|,-]+)$/;
const RE_MODIFIER = /^\+[\w-]+(:\S+)?$/;  // +key or +key:value e.g. +delayed:1w
const RE_START_DATE = /^>(\d{4}-\d{2}-\d{2})$/;
const RE_DUE_DATE = /^<(\d{4}-\d{2}-\d{2})$/;
const RE_RECURRENCE = /^\*(daily|weekday|weekly|biweekly|monthly|quarterly|yearly)$/;
const RE_EXTERNAL_REF = /^\$[\w-]+$/;

// Keywords that can appear as bare modifiers (without + prefix) in pipe fields
const MODIFIER_KEYWORDS = new Set([
  'deadline', 'fixed', 'external', 'waiting', 'at-risk', 'blocked',
  'critical', 'tentative', 'recurring', 'milestone', 'delayed', 'hard-block',
]);

// ── Status parsing ────────────────────────────────────────────────────────────

function parseStatus(content: string): { status: Status; rest: string } | null {
  // Word form: [new], [active], etc.
  const wordMatch = content.match(/^\[([\w-]+)\]\s*/);
  if (wordMatch) {
    const word = wordMatch[1].toLowerCase();
    if (WORD_TO_STATUS[word]) {
      return { status: WORD_TO_STATUS[word], rest: content.slice(wordMatch[0].length) };
    }
  }
  // Sigil form: [ ], [~], [x], etc.
  const sigilMatch = content.match(/^\[(.)\]\s*/);
  if (sigilMatch) {
    const sigil = sigilMatch[1];
    if (SIGIL_TO_STATUS[sigil] !== undefined) {
      return { status: SIGIL_TO_STATUS[sigil], rest: content.slice(sigilMatch[0].length) };
    }
  }
  return null;
}

// ── Field parsing ─────────────────────────────────────────────────────────────

interface ParsedFields {
  assignees: string[];
  tags: string[];
  priority?: Priority;
  progress?: number;
  duration?: Duration;
  startDate?: string;
  dueDate?: string;
  after: Dependency[];
  modifiers: string[];
  recurrence?: string;
  externalRef?: string;
  id?: string;
}

function parseFields(segments: string[]): ParsedFields {
  const result: ParsedFields = { assignees: [], tags: [], after: [], modifiers: [] };

  for (const seg of segments) {
    const s = seg.trim();
    if (!s) continue;

    // Duration
    const durMatch = s.match(RE_DURATION);
    if (durMatch && !result.duration) {
      result.duration = { value: parseFloat(durMatch[1]), unit: durMatch[2] as DurationUnit };
      continue;
    }

    // Start date
    const startMatch = s.match(RE_START_DATE);
    if (startMatch) {
      result.startDate = startMatch[1];
      continue;
    }

    // Due date
    const dueMatch = s.match(RE_DUE_DATE);
    if (dueMatch) {
      result.dueDate = dueMatch[1];
      continue;
    }

    // ID
    const idMatch = s.match(RE_ID);
    if (idMatch) {
      result.id = idMatch[1];
      continue;
    }

    // After dependency
    const afterMatch = s.match(RE_AFTER);
    if (afterMatch) {
      const raw = afterMatch[1];
      if (raw.includes('|')) {
        result.after.push({ ids: raw.split('|').filter(Boolean), logic: 'or' });
      } else {
        result.after.push({ ids: raw.split(',').filter(Boolean), logic: 'and' });
      }
      continue;
    }

    // Priority
    const prioMatch = s.match(RE_PRIORITY);
    if (prioMatch) {
      result.priority = prioMatch[1] as Priority;
      continue;
    }

    // Progress
    const progressMatch = s.match(RE_PROGRESS);
    if (progressMatch) {
      result.progress = Math.min(100, Math.max(0, parseInt(progressMatch[1], 10)));
      continue;
    }

    // Recurrence
    const recurMatch = s.match(RE_RECURRENCE);
    if (recurMatch) {
      result.recurrence = recurMatch[1];
      continue;
    }

    // Modifier with + prefix
    if (RE_MODIFIER.test(s)) {
      result.modifiers.push(s.slice(1));
      continue;
    }

    // Bare modifier keyword (without + prefix): e.g. blocked, delayed:1w
    const bareModMatch = s.match(/^([\w-]+)(:\S+)?$/);
    if (bareModMatch && MODIFIER_KEYWORDS.has(bareModMatch[1])) {
      result.modifiers.push(s);
      continue;
    }

    // External ref
    if (RE_EXTERNAL_REF.test(s)) {
      result.externalRef = s;
      continue;
    }

    // Assignees (may have multiple @mentions in one segment)
    const assigneeMatches = s.match(/(@[\w-]+)/g);
    if (assigneeMatches && s.replace(/(@[\w-]+)/g, '').trim() === '') {
      result.assignees.push(...assigneeMatches.map(a => a.slice(1)));
      continue;
    }

    // Hash ID shortcut: #slug = id:slug
    const hashIdMatch = s.match(RE_HASH_ID);
    if (hashIdMatch) {
      result.id = hashIdMatch[1];
      continue;
    }
  }

  return result;
}

// Split content on '|' but re-join segments that belong to an after:id1|id2 OR dep.
// An after: segment followed by a token that looks like a bare id (no keyword prefix)
// is part of an OR dependency list.
function splitPipeFields(content: string): string[] {
  const raw = content.split('|');
  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i].trim();
    // If the previous merged segment ends with an after: chain, a bare id continues it
    if (
      merged.length > 0 &&
      /^after:/.test(merged[merged.length - 1].trim()) &&
      /^[\w-]+$/.test(seg)
    ) {
      merged[merged.length - 1] += '|' + seg;
    } else {
      merged.push(raw[i]);
    }
  }
  return merged;
}

// Parse "name | field | field ..." returning name and fields
function parseNameAndFields(content: string): { name: string; fields: ParsedFields } {
  const parts = splitPipeFields(content);
  const name = (parts[0] ?? '').trim();
  const fields = parseFields(parts.slice(1));
  return { name, fields };
}

// ── Task / Milestone constructors ─────────────────────────────────────────────

function buildTask(content: string, line: number, depth: number = 0): Task {
  const statusResult = parseStatus(content);
  const status: Status = statusResult?.status ?? 'new';
  const rest = statusResult?.rest ?? content;
  const { name, fields } = parseNameAndFields(rest);

  const task: Task = {
    type: 'task',
    status,
    name,
    assignees: fields.assignees,
    tags: fields.tags,
    after: fields.after,
    modifiers: fields.modifiers,
    subtasks: [],
    line,
  };

  if (fields.id) task.id = fields.id;
  if (fields.priority) task.priority = fields.priority;
  if (fields.progress !== undefined) task.progress = fields.progress;
  if (fields.duration) task.duration = fields.duration;
  if (fields.startDate) task.startDate = fields.startDate;
  if (fields.dueDate) task.dueDate = fields.dueDate;
  if (fields.recurrence) task.recurrence = fields.recurrence;
  if (fields.externalRef) task.externalRef = fields.externalRef;

  return task;
}

function buildMilestone(content: string, line: number): Milestone {
  const { name, fields } = parseNameAndFields(content);
  const ms: Milestone = {
    type: 'milestone',
    name,
    after: fields.after,
    modifiers: fields.modifiers,
    line,
  };
  if (fields.id) ms.id = fields.id;
  if (fields.startDate) ms.date = fields.startDate;
  if (fields.dueDate) ms.date = fields.dueDate;
  return ms;
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parse(source: string): { doc: YattDocument; errors: ParseError[] } {
  const tokens = tokenize(source);
  const errors: ParseError[] = [];
  const header: YattHeader = {};
  const items: DocumentItem[] = [];
  const idMap = new Map<string, Task | Milestone | ParallelBlock>();

  function registerId(id: string, item: Task | Milestone | ParallelBlock, line: number) {
    if (idMap.has(id)) {
      errors.push({ message: `Duplicate ID: "${id}"`, line, severity: 'error' });
    } else {
      idMap.set(id, item);
    }
  }

  // ── Pass 1: Build AST ──────────────────────────────────────────────────────

  let i = 0;
  // Collect header fields first
  while (i < tokens.length && tokens[i].type === 'header-field') {
    const tok = tokens[i++];
    switch (tok.key) {
      case 'title':       header.title = tok.value; break;
      case 'owner':       header.owner = tok.value; break;
      case 'start':       header.start = tok.value; break;
      case 'schedule':
        if (tok.value === 'business-days' || tok.value === 'calendar-days') {
          header.schedule = tok.value;
        }
        break;
      case 'timezone':    header.timezone = tok.value; break;
      case 'week-start':
        if (tok.value === 'mon' || tok.value === 'sun') header.weekStart = tok.value;
        break;
    }
  }

  // Parse body tokens
  // Parallel blocks can nest (though spec shows single-level usage)
  const parallelStack: ParallelBlock[] = [];

  function currentContainer(): { items: DocumentItem[] } {
    if (parallelStack.length > 0) {
      return parallelStack[parallelStack.length - 1];
    }
    return { items };
  }

  // Track last task at each depth for subtask attachment
  // depth 0 = top-level task, 1 = first subtask level, etc.
  const taskStack: (Task | null)[] = [null, null, null, null];

  function resetTaskStack() {
    taskStack[0] = taskStack[1] = taskStack[2] = taskStack[3] = null;
  }

  while (i < tokens.length) {
    const tok = tokens[i++];

    if (tok.type === 'blank' || tok.type === 'header-field') continue;

    if (tok.type === 'comment') {
      const comment: Comment = { type: 'comment', text: tok.content ?? '', line: tok.line };
      currentContainer().items.push(comment);
      continue;
    }

    if (tok.type === 'section') {
      resetTaskStack();
      const section: Section = {
        type: 'section',
        title: tok.content ?? '',
        level: (tok.level === 2 ? 2 : 1) as 1 | 2 | 3,
        line: tok.line,
      };
      currentContainer().items.push(section);
      continue;
    }

    if (tok.type === 'parallel-open') {
      resetTaskStack();
      // content may be "name | field | field" or just "name" or empty
      const content = tok.content ?? '';
      const pipeIdx = content.indexOf('|');
      let blockName: string | undefined;
      let blockFields: ReturnType<typeof parseFields>;

      if (pipeIdx !== -1) {
        blockName = content.slice(0, pipeIdx).trim() || undefined;
        blockFields = parseFields(content.slice(pipeIdx + 1).split('|'));
      } else {
        blockName = content.trim() || undefined;
        blockFields = parseFields([]);
      }

      const block: ParallelBlock = {
        type: 'parallel',
        name: blockName,
        id: blockName ?? undefined,
        after: blockFields.after,
        items: [],
        line: tok.line,
      };

      if (block.id) registerId(block.id, block, tok.line);
      currentContainer().items.push(block);
      parallelStack.push(block);
      continue;
    }

    if (tok.type === 'parallel-close') {
      resetTaskStack();
      if (parallelStack.length === 0) {
        errors.push({ message: 'Unexpected end: without matching parallel:', line: tok.line, severity: 'error' });
      } else {
        parallelStack.pop();
      }
      continue;
    }

    if (tok.type === 'milestone') {
      resetTaskStack();
      const ms = buildMilestone(tok.content ?? '', tok.line);
      if (ms.id) registerId(ms.id, ms, tok.line);
      currentContainer().items.push(ms);
      continue;
    }

    if (tok.type === 'task') {
      const task = buildTask(tok.content ?? '', tok.line, 0);
      if (task.id) registerId(task.id, task, tok.line);
      currentContainer().items.push(task);
      taskStack[0] = task;
      taskStack[1] = taskStack[2] = taskStack[3] = null;
      continue;
    }

    if (tok.type === 'subtask') {
      const depth = tok.depth ?? 1;
      const task = buildTask(tok.content ?? '', tok.line, depth);
      if (task.id) registerId(task.id, task, tok.line);
      taskStack[depth] = task;
      // Clear deeper levels
      for (let d = depth + 1; d <= 3; d++) taskStack[d] = null;

      // Find parent
      let attached = false;
      for (let pd = depth - 1; pd >= 0; pd--) {
        if (taskStack[pd]) {
          taskStack[pd]!.subtasks.push(task);
          attached = true;
          break;
        }
      }
      if (!attached) {
        // No parent task found — attach to current container as top-level
        currentContainer().items.push(task);
      }
      continue;
    }
  }

  if (parallelStack.length > 0) {
    errors.push({
      message: `Unclosed parallel block: "${parallelStack[parallelStack.length - 1].name ?? '(anonymous)'}"`,
      line: parallelStack[parallelStack.length - 1].line,
      severity: 'error',
    });
  }

  const doc: YattDocument = { header, items, idMap };

  // ── Pass 2: Resolve after: references ────────────────────────────────────

  function resolveItem(item: Task | Milestone) {
    for (const dep of item.after) {
      for (const id of dep.ids) {
        if (!idMap.has(id)) {
          errors.push({
            message: `Unknown dependency ID: "${id}"`,
            line: item.line,
            severity: 'error',
          });
        }
      }
    }
    if (item.type === 'task') {
      for (const sub of item.subtasks) resolveItem(sub);
    }
  }

  function resolveBlock(block: ParallelBlock) {
    for (const dep of block.after) {
      for (const id of dep.ids) {
        if (!idMap.has(id)) {
          errors.push({
            message: `Unknown dependency ID: "${id}" in parallel block`,
            line: block.line,
            severity: 'error',
          });
        }
      }
    }
    for (const it of block.items) {
      if (it.type === 'task' || it.type === 'milestone') resolveItem(it);
      else if (it.type === 'parallel') resolveBlock(it);
    }
  }

  for (const item of items) {
    if (item.type === 'task' || item.type === 'milestone') resolveItem(item);
    else if (item.type === 'parallel') resolveBlock(item);
  }

  return { doc, errors };
}
