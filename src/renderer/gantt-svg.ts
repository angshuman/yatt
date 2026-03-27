import { YattDocument, Task, Milestone, ParallelBlock, DocumentItem, Status } from '../types.js';

export interface GanttOptions {
  width?: number;
  rowHeight?: number;
  headerHeight?: number;
  padding?: number;
  fontFamily?: string;
  theme?: 'light' | 'dark';
}

interface ResolvedOptions {
  width: number;
  rowHeight: number;
  headerHeight: number;
  padding: number;
  fontFamily: string;
  theme: 'light' | 'dark';
}

const STATUS_COLORS: Record<Status, string> = {
  new:       '#94a3b8',
  active:    '#3b82f6',
  done:      '#22c55e',
  blocked:   '#ef4444',
  'at-risk': '#f59e0b',
  deferred:  '#a78bfa',
  cancelled: '#6b7280',
  review:    '#8b5cf6',
  paused:    '#64748b',
};

const STATUS_DARK: Record<Status, string> = {
  new:       '#94a3b8',
  active:    '#60a5fa',
  done:      '#4ade80',
  blocked:   '#f87171',
  'at-risk': '#fbbf24',
  deferred:  '#c4b5fd',
  cancelled: '#4b5563',
  review:    '#a78bfa',
  paused:    '#64748b',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Row model ─────────────────────────────────────────────────────────────────

interface GanttRow {
  kind: 'task' | 'milestone' | 'parallel-header';
  task?: Task;
  milestone?: Milestone;
  block?: ParallelBlock;
  depth: number;         // subtask indent level
  inBlock?: boolean;
  blockStart?: Date;
  blockEnd?: Date;
  blockRowStart?: number; // row index where block begins
  isLastInBlock?: boolean;
}

function collectRows(items: Array<DocumentItem | Task>, depth: number, rows: GanttRow[], inBlock: boolean, block?: ParallelBlock): void {
  for (const item of items) {
    if (item.type === 'task') {
      rows.push({ kind: 'task', task: item, depth, inBlock, block });
      if (item.subtasks.length > 0) {
        collectRows(item.subtasks as unknown as Array<DocumentItem>, depth + 1, rows, inBlock, block);
      }
    } else if (item.type === 'milestone') {
      rows.push({ kind: 'milestone', milestone: item, depth, inBlock, block });
    } else if (item.type === 'parallel') {
      const blockStartRow = rows.length;
      rows.push({ kind: 'parallel-header', block: item, depth, blockRowStart: blockStartRow });
      collectRows(item.items as Array<DocumentItem>, depth, rows, true, item);
      // Mark last row in block
      if (rows.length > blockStartRow) {
        rows[rows.length - 1].isLastInBlock = true;
      }
    }
    // section/comment: skip in Gantt
  }
}

// ── Time axis ─────────────────────────────────────────────────────────────────

function getDates(rows: GanttRow[]): { minDate: Date; maxDate: Date } {
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    if (row.kind === 'task' && row.task) {
      if (row.task.computedStart) min = Math.min(min, row.task.computedStart.getTime());
      if (row.task.computedEnd)   max = Math.max(max, row.task.computedEnd.getTime());
    }
    if (row.kind === 'milestone' && row.milestone?.computedDate) {
      const t = row.milestone.computedDate.getTime();
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }

  if (!isFinite(min)) min = Date.now();
  if (!isFinite(max)) max = min + 7 * 86400000;

  // Add 5% padding on each side
  const span = max - min;
  return {
    minDate: new Date(min - span * 0.02),
    maxDate: new Date(max + span * 0.05),
  };
}

type TickGranularity = 'day' | 'week' | 'month' | 'quarter';

function getGranularity(spanDays: number): TickGranularity {
  if (spanDays < 30) return 'day';
  if (spanDays < 180) return 'week';
  if (spanDays < 365) return 'month';
  return 'quarter';
}

function generateTicks(minD: Date, maxD: Date, granularity: TickGranularity): Date[] {
  const ticks: Date[] = [];
  const cur = new Date(minD);

  if (granularity === 'day') {
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= maxD) {
      ticks.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (granularity === 'week') {
    // Align to Monday
    cur.setUTCHours(0, 0, 0, 0);
    const dow = cur.getUTCDay();
    const toMon = dow === 0 ? -6 : 1 - dow;
    cur.setUTCDate(cur.getUTCDate() + toMon);
    while (cur <= maxD) {
      ticks.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } else if (granularity === 'month') {
    cur.setUTCDate(1);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= maxD) {
      ticks.push(new Date(cur));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  } else {
    // quarter
    cur.setUTCDate(1);
    cur.setUTCHours(0, 0, 0, 0);
    const q = Math.floor(cur.getUTCMonth() / 3);
    cur.setUTCMonth(q * 3);
    while (cur <= maxD) {
      ticks.push(new Date(cur));
      cur.setUTCMonth(cur.getUTCMonth() + 3);
    }
  }
  return ticks;
}

function formatTick(d: Date, granularity: TickGranularity): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (granularity === 'day') {
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  }
  if (granularity === 'week') {
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  if (granularity === 'month') {
    return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function rect(x: number, y: number, w: number, h: number, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" ${attrStr}/>`;
}

function text(x: number, y: number, content: string, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<text x="${x}" y="${y}" ${attrStr}>${escapeXml(content)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrStr}/>`;
}

function circle(cx: number, cy: number, r: number, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrStr}/>`;
}

function diamond(cx: number, cy: number, size: number, fill: string): string {
  const s = size / 2;
  return `<polygon points="${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}" fill="${fill}"/>`;
}

function initials(name: string): string {
  return name.split(/[\s_-]/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderGanttSVG(doc: YattDocument, options?: GanttOptions): string {
  const opts: ResolvedOptions = {
    width:        options?.width        ?? 1200,
    rowHeight:    options?.rowHeight    ?? 28,
    headerHeight: options?.headerHeight ?? 40,
    padding:      options?.padding      ?? 16,
    fontFamily:   options?.fontFamily   ?? 'ui-sans-serif, system-ui, sans-serif',
    theme:        options?.theme        ?? 'light',
  };

  const isDark      = opts.theme === 'dark';
  const bgColor     = isDark ? '#0f172a' : '#ffffff';
  const textColor   = isDark ? '#e2e8f0' : '#1e293b';
  const mutedColor  = isDark ? '#64748b'  : '#94a3b8';
  const trackColor  = isDark ? '#1e293b'  : '#f1f5f9';
  const borderColor = isDark ? '#334155'  : '#e2e8f0';
  const labelWidth  = 200;
  const chartLeft   = opts.padding + labelWidth;
  const chartWidth  = opts.width - chartLeft - opts.padding;

  const rows: GanttRow[] = [];
  collectRows(doc.items as Array<DocumentItem>, 0, rows, false);

  const { minDate, maxDate } = getDates(rows);
  const totalMs = maxDate.getTime() - minDate.getTime();
  const spanDays = totalMs / 86400000;

  function dateToX(d: Date): number {
    const frac = (d.getTime() - minDate.getTime()) / totalMs;
    return chartLeft + frac * chartWidth;
  }

  const granularity = getGranularity(spanDays);
  const ticks = generateTicks(minDate, maxDate, granularity);
  const totalHeight = opts.headerHeight + rows.length * opts.rowHeight + opts.padding;

  const parts: string[] = [];

  // ── Defs ────────────────────────────────────────────────────────────────────
  parts.push(`<defs>
  <clipPath id="chart-clip"><rect x="${chartLeft}" y="0" width="${chartWidth}" height="${totalHeight}"/></clipPath>
</defs>`);

  // ── Background ──────────────────────────────────────────────────────────────
  parts.push(rect(0, 0, opts.width, totalHeight, { fill: bgColor }));

  // ── Title ───────────────────────────────────────────────────────────────────
  if (doc.header.title) {
    parts.push(text(opts.padding, opts.headerHeight / 2 + 5, doc.header.title, {
      fill: textColor, 'font-size': '14', 'font-weight': '600', 'font-family': opts.fontFamily,
    }));
  }

  // ── Time axis ───────────────────────────────────────────────────────────────
  const axisY = opts.headerHeight - 1;
  parts.push(line(chartLeft, axisY, chartLeft + chartWidth, axisY, {
    stroke: borderColor, 'stroke-width': '1',
  }));

  for (const tick of ticks) {
    const x = dateToX(tick);
    if (x < chartLeft || x > chartLeft + chartWidth) continue;
    parts.push(line(x, opts.headerHeight, x, totalHeight, {
      stroke: trackColor, 'stroke-width': '1', 'clip-path': 'url(#chart-clip)',
    }));
    parts.push(line(x, axisY - 4, x, axisY, { stroke: mutedColor, 'stroke-width': '1' }));
    parts.push(text(x + 3, axisY - 6, formatTick(tick, granularity), {
      fill: mutedColor, 'font-size': '10', 'font-family': opts.fontFamily,
    }));
  }

  // ── Parallel block left-border decoration ───────────────────────────────────
  {
    interface BlockRange { block: ParallelBlock; rowStart: number; rowEnd: number }
    const blockRanges: BlockRange[] = [];
    const blockStack: { block: ParallelBlock; rowStart: number }[] = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (row.kind === 'parallel-header' && row.block) blockStack.push({ block: row.block, rowStart: ri });
      if (row.isLastInBlock && blockStack.length > 0) {
        const entry = blockStack.pop()!;
        blockRanges.push({ block: entry.block, rowStart: entry.rowStart, rowEnd: ri });
      }
    }
    for (const br of blockRanges) {
      const by = opts.headerHeight + br.rowStart * opts.rowHeight;
      const bh = (br.rowEnd - br.rowStart + 1) * opts.rowHeight;
      parts.push(line(opts.padding / 2, by + 4, opts.padding / 2, by + bh - 4, {
        stroke: '#6366f1', 'stroke-width': '2', opacity: '0.35',
      }));
    }
  }

  // ── Rows ────────────────────────────────────────────────────────────────────
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowY = opts.headerHeight + ri * opts.rowHeight;
    const midY = rowY + opts.rowHeight / 2;

    // ── Parallel section header ──────────────────────────────────────────────
    if (row.kind === 'parallel-header' && row.block) {
      const indent = row.depth * 14 + opts.padding;
      const blockName = (row.block.name ?? '(parallel)').toUpperCase();
      parts.push(text(indent, midY + 4, blockName, {
        fill: isDark ? '#818cf8' : '#6366f1',
        'font-size': '9', 'font-weight': '700', 'letter-spacing': '0.08em',
        'font-family': opts.fontFamily,
      }));
      continue;
    }

    // ── Task ────────────────────────────────────────────────────────────────
    if (row.kind === 'task' && row.task) {
      const task   = row.task;
      const isSubtask = row.depth > 0;
      const indent    = row.depth * 14 + opts.padding;
      const color     = isDark ? STATUS_DARK[task.status] : STATUS_COLORS[task.status];
      const isCancelled = task.status === 'cancelled';
      const isPending   = task.status === 'new' || task.status === 'deferred' || task.status === 'paused';
      const lineColor   = isCancelled ? mutedColor : color;
      const mainOpacity = isCancelled ? 0.4 : (isPending ? 0.6 : 1);
      const sw = isSubtask ? 1.5 : 2;
      const dotR = isSubtask ? 3 : 4;

      // Label: tiny status dot + name
      parts.push(circle(indent + 4, midY, 2.5, {
        fill: lineColor, opacity: mainOpacity,
      }));
      const labelText = task.name.length > 27 ? task.name.slice(0, 25) + '…' : task.name;
      parts.push(text(indent + 12, midY + 4, labelText, {
        fill: isCancelled ? mutedColor : textColor,
        'font-size': isSubtask ? '11' : '12',
        'font-family': opts.fontFamily,
        opacity: isCancelled ? '0.45' : '1',
      }));

      if (!task.computedStart || !task.computedEnd) continue;

      const delayedMod    = task.modifiers.find(m => m.startsWith('delayed:'));
      const blockedTimeMod = task.modifiers.find(m => m.startsWith('blocked:'));

      // Main line ends at delayStart (if delayed), otherwise at computedEnd
      const taskEndDate = (delayedMod && task.delayStart) ? task.delayStart : task.computedEnd;
      const x1 = dateToX(task.computedStart);
      const x2 = Math.max(x1 + 5, dateToX(taskEndDate));

      // Row track guide (very faint)
      parts.push(line(chartLeft, midY, chartLeft + chartWidth, midY, {
        stroke: trackColor, 'stroke-width': '1', 'clip-path': 'url(#chart-clip)',
      }));

      // ── Ghost line (blocked original position) ──────────────────────────
      if (blockedTimeMod && task.plannedStart && task.plannedEnd) {
        const gx1 = dateToX(task.plannedStart);
        const gx2 = Math.max(gx1 + 4, dateToX(task.plannedEnd));
        parts.push(line(gx1, midY, gx2, midY, {
          stroke: '#ef4444', 'stroke-width': String(sw - 0.5),
          'stroke-dasharray': '3,3', 'stroke-linecap': 'round',
          opacity: '0.35', 'clip-path': 'url(#chart-clip)',
        }));
        parts.push(circle(gx1, midY, dotR - 1, {
          fill: 'none', stroke: '#ef4444', 'stroke-width': '1.5',
          opacity: '0.35', 'clip-path': 'url(#chart-clip)',
        }));
        parts.push(circle(gx2, midY, dotR - 1, {
          fill: 'none', stroke: '#ef4444', 'stroke-width': '1.5',
          opacity: '0.35', 'clip-path': 'url(#chart-clip)',
        }));
        if (x1 > gx2 + 6) {
          parts.push(line(gx2, midY, x1, midY, {
            stroke: '#ef4444', 'stroke-width': '1',
            'stroke-dasharray': '2,5', opacity: '0.2',
            'clip-path': 'url(#chart-clip)',
          }));
        }
      }

      // ── Main task line ───────────────────────────────────────────────────
      const dashArr = isPending ? '5,4' : undefined;
      const span = x2 - x1;

      if (task.progress != null && task.progress > 0 && !isCancelled) {
        const progX = x1 + span * (task.progress / 100);
        // Dim trailing portion
        parts.push(line(x1, midY, x2, midY, {
          stroke: lineColor, 'stroke-width': String(sw), opacity: '0.2',
          'stroke-linecap': 'round', 'clip-path': 'url(#chart-clip)',
          ...(dashArr ? { 'stroke-dasharray': dashArr } : {}),
        }));
        // Bright leading portion
        parts.push(line(x1, midY, progX, midY, {
          stroke: lineColor, 'stroke-width': String(sw + 0.5),
          'stroke-linecap': 'round', 'clip-path': 'url(#chart-clip)',
        }));
      } else {
        parts.push(line(x1, midY, x2, midY, {
          stroke: lineColor, 'stroke-width': String(sw), opacity: String(mainOpacity),
          'stroke-linecap': 'round', 'clip-path': 'url(#chart-clip)',
          ...(dashArr ? { 'stroke-dasharray': dashArr } : {}),
        }));
      }

      // Start dot (filled)
      parts.push(circle(x1, midY, dotR, {
        fill: lineColor, opacity: String(mainOpacity), 'clip-path': 'url(#chart-clip)',
      }));

      // End dot: filled for done, hollow otherwise
      if (task.status === 'done') {
        parts.push(circle(x2, midY, dotR, { fill: lineColor, 'clip-path': 'url(#chart-clip)' }));
      } else {
        parts.push(circle(x2, midY, dotR, {
          fill: bgColor, stroke: lineColor, 'stroke-width': '1.5',
          opacity: String(mainOpacity), 'clip-path': 'url(#chart-clip)',
        }));
      }

      // ── Delayed overrun (orange dotted extension) ────────────────────────
      if (delayedMod && task.delayStart && task.computedEnd) {
        const ox1 = dateToX(task.delayStart);
        const ox2 = Math.max(ox1 + 5, dateToX(task.computedEnd));
        parts.push(line(ox1, midY, ox2, midY, {
          stroke: '#f59e0b', 'stroke-width': String(sw),
          'stroke-dasharray': '4,3', 'stroke-linecap': 'round',
          opacity: '0.7', 'clip-path': 'url(#chart-clip)',
        }));
        parts.push(circle(ox2, midY, dotR, {
          fill: 'none', stroke: '#f59e0b', 'stroke-width': '1.5',
          opacity: '0.7', 'clip-path': 'url(#chart-clip)',
        }));
      }

      // ── Deadline hairline ────────────────────────────────────────────────
      if (task.modifiers.includes('deadline') && task.dueDate) {
        const dlX = dateToX(new Date(task.dueDate + 'T00:00:00Z'));
        parts.push(line(dlX, rowY + 3, dlX, rowY + opts.rowHeight - 3, {
          stroke: '#ef4444', 'stroke-width': '1.5',
          'stroke-dasharray': '2,2', opacity: '0.6',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // ── Assignee circles ─────────────────────────────────────────────────
      if (task.assignees.length > 0) {
        const circleR = 8;
        const visualEnd = (delayedMod && task.delayStart && task.computedEnd)
          ? dateToX(task.computedEnd)
          : x2;
        let cx = visualEnd + circleR + 5;
        for (const assignee of task.assignees.slice(0, 3)) {
          parts.push(circle(cx, midY, circleR, {
            fill: bgColor, stroke: lineColor, 'stroke-width': '1.5',
            'clip-path': 'url(#chart-clip)',
          }));
          parts.push(text(cx, midY + 3.5, initials(assignee), {
            fill: textColor, 'font-size': '7', 'font-weight': '600',
            'text-anchor': 'middle', 'font-family': opts.fontFamily,
            'clip-path': 'url(#chart-clip)',
          }));
          cx += circleR * 1.9;
        }
      }

      // ── Clickable overlay ────────────────────────────────────────────────
      if (task.description) {
        parts.push(`<rect x="0" y="${rowY}" width="${opts.width}" height="${opts.rowHeight}" fill="transparent" data-line="${task.line}" style="cursor:pointer"><title>${escapeXml(task.description)}</title></rect>`);
      } else {
        parts.push(rect(0, rowY, opts.width, opts.rowHeight, {
          fill: 'transparent', 'data-line': task.line, style: 'cursor:pointer',
        }));
      }
    }

    // ── Milestone ────────────────────────────────────────────────────────────
    if (row.kind === 'milestone' && row.milestone) {
      const ms     = row.milestone;
      const indent = row.depth * 14 + opts.padding;

      const labelText = ms.name.length > 27 ? ms.name.slice(0, 25) + '…' : ms.name;
      parts.push(text(indent + 12, midY + 4, labelText, {
        fill: isDark ? '#fbbf24' : '#92400e',
        'font-size': '11', 'font-style': 'italic', 'font-family': opts.fontFamily,
      }));

      if (!ms.computedDate) continue;
      const dmx = dateToX(ms.computedDate);
      const msR  = row.depth > 0 ? 4 : 5;

      if (ms.modifiers.includes('deadline')) {
        parts.push(line(dmx, opts.headerHeight, dmx, totalHeight, {
          stroke: '#ef4444', 'stroke-width': '1', opacity: '0.2',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Bullseye: filled outer ring + bg inner dot
      parts.push(circle(dmx, midY, msR, {
        fill: isDark ? '#fbbf24' : '#d97706', 'clip-path': 'url(#chart-clip)',
      }));
      parts.push(circle(dmx, midY, msR - 2.5, {
        fill: bgColor, 'clip-path': 'url(#chart-clip)',
      }));

      parts.push(text(dmx + msR + 4, midY + 3.5, ms.name.slice(0, 18), {
        fill: isDark ? '#fbbf24' : '#92400e',
        'font-size': '9', 'font-weight': '600', 'font-family': opts.fontFamily,
        'clip-path': 'url(#chart-clip)',
      }));
    }
  }

  // ── Today line ──────────────────────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (today >= minDate && today <= maxDate) {
    const tx = dateToX(today);
    parts.push(line(tx, opts.headerHeight, tx, totalHeight, {
      stroke: '#ef4444', 'stroke-width': '1', opacity: '0.5',
    }));
    parts.push(circle(tx, opts.headerHeight, 3, { fill: '#ef4444', opacity: '0.7' }));
  }

  // ── Label/chart separator ───────────────────────────────────────────────────
  parts.push(line(chartLeft, 0, chartLeft, totalHeight, {
    stroke: borderColor, 'stroke-width': '1', opacity: '0.6',
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${totalHeight}" viewBox="0 0 ${opts.width} ${totalHeight}" font-family="${opts.fontFamily}">
${parts.join('\n')}
</svg>`;
}

