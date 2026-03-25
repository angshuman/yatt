export type TokenType =
  | 'comment'
  | 'section'
  | 'parallel-open'
  | 'parallel-close'
  | 'milestone'
  | 'task'
  | 'subtask'
  | 'blank'
  | 'header-field';

export interface Token {
  type: TokenType;
  raw: string;
  line: number;
  // For subtask: depth 1, 2, or 3
  depth?: number;
  // Extracted content after classification prefix
  content?: string;
  // For header-field: key and value
  key?: string;
  value?: string;
  // For section: level 1 or 2
  level?: number;
}

const HEADER_KEYS = new Set([
  'title', 'owner', 'start', 'schedule', 'timezone', 'week-start',
]);

export function tokenize(source: string): Token[] {
  const lines = source.split(/\r?\n/);
  const tokens: Token[] = [];
  let headerMode = true;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      tokens.push({ type: 'blank', raw, line: lineNum });
      continue;
    }

    // Comment
    if (trimmed.startsWith('//')) {
      tokens.push({ type: 'comment', raw, line: lineNum, content: trimmed.slice(2).trim() });
      continue;
    }

    // Section header (## or #)
    if (trimmed.startsWith('##')) {
      headerMode = false;
      tokens.push({ type: 'section', raw, line: lineNum, level: 2, content: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith('#')) {
      headerMode = false;
      tokens.push({ type: 'section', raw, line: lineNum, level: 1, content: trimmed.slice(1).trim() });
      continue;
    }

    // Parallel open: "parallel: name" or "parallel:"
    if (/^parallel\s*:/i.test(trimmed)) {
      headerMode = false;
      const rest = trimmed.replace(/^parallel\s*:\s*/i, '');
      tokens.push({ type: 'parallel-open', raw, line: lineNum, content: rest });
      continue;
    }

    // Parallel close: "end: name" or "end:"
    if (/^end\s*:/i.test(trimmed)) {
      headerMode = false;
      const rest = trimmed.replace(/^end\s*:\s*/i, '');
      tokens.push({ type: 'parallel-close', raw, line: lineNum, content: rest });
      continue;
    }

    // Milestone: ">> text | fields"
    if (trimmed.startsWith('>>')) {
      headerMode = false;
      tokens.push({ type: 'milestone', raw, line: lineNum, content: trimmed.slice(2).trim() });
      continue;
    }

    // Subtask level 3: "... [status] text"
    if (trimmed.startsWith('...')) {
      headerMode = false;
      tokens.push({ type: 'subtask', raw, line: lineNum, depth: 3, content: trimmed.slice(3).trim() });
      continue;
    }

    // Subtask level 2: ".. [status] text"
    if (trimmed.startsWith('..') && !trimmed.startsWith('...')) {
      headerMode = false;
      tokens.push({ type: 'subtask', raw, line: lineNum, depth: 2, content: trimmed.slice(2).trim() });
      continue;
    }

    // Subtask level 1: ". [status] text"
    if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
      headerMode = false;
      tokens.push({ type: 'subtask', raw, line: lineNum, depth: 1, content: trimmed.slice(1).trim() });
      continue;
    }

    // Task: "[status] text | fields"
    if (trimmed.startsWith('[')) {
      headerMode = false;
      tokens.push({ type: 'task', raw, line: lineNum, content: trimmed });
      continue;
    }

    // Header field: "key: value" lines before any non-header content
    if (headerMode) {
      const headerMatch = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (headerMatch && HEADER_KEYS.has(headerMatch[1].toLowerCase())) {
        tokens.push({
          type: 'header-field',
          raw,
          line: lineNum,
          key: headerMatch[1].toLowerCase(),
          value: headerMatch[2].trim(),
        });
        continue;
      }
    }

    // Plain text line or markdown list item — treat as task with 'new' status
    headerMode = false;
    let plainContent = trimmed;
    const listMarkerMatch = trimmed.match(/^(?:[-*]\s+|\d+[.)]\s+)/);
    if (listMarkerMatch) {
      plainContent = trimmed.slice(listMarkerMatch[0].length);
    }
    tokens.push({ type: 'task', raw, line: lineNum, content: plainContent });
  }

  return tokens;
}
