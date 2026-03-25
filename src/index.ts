export { parse } from './parser.js';
export { validate } from './validator.js';
export { schedule } from './scheduler.js';
export { renderGanttSVG } from './renderer/gantt-svg.js';
export { renderListHTML } from './renderer/list-html.js';

export type { GanttOptions } from './renderer/gantt-svg.js';
export type { ListOptions } from './renderer/list-html.js';

export type {
  Status,
  Priority,
  DurationUnit,
  Duration,
  DateRange,
  Dependency,
  Task,
  Milestone,
  ParallelBlock,
  Section,
  Comment,
  DocumentItem,
  YattHeader,
  YattDocument,
  ParseError,
} from './types.js';

import { parse } from './parser.js';
import { validate } from './validator.js';
import { schedule } from './scheduler.js';
import { renderGanttSVG } from './renderer/gantt-svg.js';
import { renderListHTML } from './renderer/list-html.js';
import type { ParseError } from './types.js';

export function render(
  source: string,
  format?: 'gantt' | 'list',
): { html: string; errors: ParseError[] } {
  const { doc, errors: parseErrors } = parse(source);
  const validationErrors = validate(doc);
  const allErrors = [...parseErrors, ...validationErrors];

  const scheduled = schedule(doc);

  if (format === 'list') {
    return { html: renderListHTML(scheduled), errors: allErrors };
  }

  // Default: gantt
  return { html: renderGanttSVG(scheduled), errors: allErrors };
}
