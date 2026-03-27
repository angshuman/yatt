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
  new:       '#22c55e',
  active:    '#1d4ed8',
  done:      '#15803d',
  blocked:   '#b91c1c',
  'at-risk': '#d97706',
  deferred:  '#7c3aed',
  cancelled: '#4b5563',
  review:    '#6d28d9',
  paused:    '#475569',
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
    rowHeight:    options?.rowHeight    ?? 36,
    headerHeight: options?.headerHeight ?? 60,
    padding:      options?.padding      ?? 16,
    fontFamily:   options?.fontFamily   ?? 'ui-sans-serif, system-ui, sans-serif',
    theme:        options?.theme        ?? 'light',
  };

  const isDark = opts.theme === 'dark';
  const bgColor       = isDark ? '#1e293b' : '#ffffff';
  const textColor     = isDark ? '#e2e8f0' : '#1e293b';
  const mutedColor    = isDark ? '#94a3b8' : '#64748b';
  const gridColor     = isDark ? '#334155' : '#e2e8f0';
  const labelWidth    = 200;
  const chartLeft     = opts.padding + labelWidth;
  const chartWidth    = opts.width - chartLeft - opts.padding;

  // Collect rows
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

  // ── Defs ──────────────────────────────────────────────────────────────────
  parts.push(`<defs>`);

  // Stripe pattern for blocked
  parts.push(`
  <pattern id="blocked-stripe" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
    <rect width="4" height="8" fill="${isDark ? '#dc2626' : '#ef4444'}" opacity="0.5"/>
  </pattern>`);

  // Clip path for chart area
  parts.push(`<clipPath id="chart-clip">
    <rect x="${chartLeft}" y="0" width="${chartWidth}" height="${totalHeight}"/>
  </clipPath>`);

  parts.push(`</defs>`);

  // ── Background ─────────────────────────────────────────────────────────────
  parts.push(rect(0, 0, opts.width, totalHeight, { fill: bgColor }));

  // ── Label column background ────────────────────────────────────────────────
  parts.push(rect(0, 0, labelWidth + opts.padding, totalHeight, { fill: isDark ? '#0f172a' : '#f8fafc' }));

  // ── Title ─────────────────────────────────────────────────────────────────
  if (doc.header.title) {
    parts.push(text(opts.padding, opts.headerHeight / 2 + 6, doc.header.title, {
      fill: textColor,
      'font-size': '16',
      'font-weight': '600',
      'font-family': opts.fontFamily,
    }));
  }

  // ── Time axis ticks ────────────────────────────────────────────────────────
  const axisY = opts.headerHeight;
  parts.push(line(chartLeft, axisY, chartLeft + chartWidth, axisY, { stroke: gridColor, 'stroke-width': '1' }));

  for (const tick of ticks) {
    const x = dateToX(tick);
    if (x < chartLeft || x > chartLeft + chartWidth) continue;
    // Vertical grid line
    parts.push(line(x, axisY, x, totalHeight, { stroke: gridColor, 'stroke-width': '1', opacity: '0.5' }));
    // Tick mark
    parts.push(line(x, axisY - 6, x, axisY, { stroke: mutedColor, 'stroke-width': '1' }));
    // Label
    parts.push(text(x + 3, axisY - 8, formatTick(tick, granularity), {
      fill: mutedColor,
      'font-size': '11',
      'font-family': opts.fontFamily,
    }));
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  // First pass: draw parallel block backgrounds
  // Find blocks and their row ranges
  interface BlockRange { block: ParallelBlock; rowStart: number; rowEnd: number }
  const blockRanges: BlockRange[] = [];
  {
    const blockStack: { block: ParallelBlock; rowStart: number }[] = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (row.kind === 'parallel-header' && row.block) {
        blockStack.push({ block: row.block, rowStart: ri });
      }
      if (row.isLastInBlock && blockStack.length > 0) {
        const entry = blockStack.pop()!;
        blockRanges.push({ block: entry.block, rowStart: entry.rowStart, rowEnd: ri });
      }
    }
  }

  for (const br of blockRanges) {
    if (!br.block.computedStart || !br.block.computedEnd) continue;
    const bx = dateToX(br.block.computedStart);
    const bw = dateToX(br.block.computedEnd) - bx;
    const by = opts.headerHeight + br.rowStart * opts.rowHeight;
    const bh = (br.rowEnd - br.rowStart + 1) * opts.rowHeight;
    parts.push(rect(bx, by, bw, bh, {
      fill: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)',
      rx: '4',
      'clip-path': 'url(#chart-clip)',
    }));
    // Left bracket line
    parts.push(line(bx - 2, by + 4, bx - 2, by + bh - 4, {
      stroke: '#6366f1',
      'stroke-width': '2',
      opacity: '0.7',
    }));
  }

  // Second pass: draw rows
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowY = opts.headerHeight + ri * opts.rowHeight;
    const midY = rowY + opts.rowHeight / 2;

    // Alternating row backgrounds
    if (ri % 2 === 1) {
      parts.push(rect(0, rowY, opts.width, opts.rowHeight, {
        fill: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
      }));
    }

    if (row.kind === 'parallel-header' && row.block) {
      const blockName = row.block.name ?? '(parallel)';
      const indent = row.depth * 12 + opts.padding;
      // Section label
      parts.push(rect(opts.padding, rowY + 2, labelWidth - opts.padding * 2, opts.rowHeight - 4, {
        fill: isDark ? '#1e3a5f' : '#eff6ff',
        rx: '3',
      }));
      parts.push(text(indent + 8, midY + 4, blockName, {
        fill: isDark ? '#93c5fd' : '#1d4ed8',
        'font-size': '12',
        'font-weight': '600',
        'font-family': opts.fontFamily,
      }));
      continue;
    }

    if (row.kind === 'task' && row.task) {
      const task = row.task;
      const isSubtask = row.depth > 0;
      const indent = row.depth * 16 + opts.padding;
      const barH = isSubtask ? opts.rowHeight * 0.55 : opts.rowHeight * 0.65;
      const barY = midY - barH / 2;

      // Label
      const labelText = task.name.length > 28 ? task.name.slice(0, 26) + '…' : task.name;
      const statusDot = STATUS_COLORS[task.status];
      // Status dot
      parts.push(`<circle cx="${indent + 6}" cy="${midY}" r="4" fill="${statusDot}"/>`);
      parts.push(text(indent + 16, midY + 4, labelText, {
        fill: textColor,
        'font-size': isSubtask ? '11' : '12',
        'font-family': opts.fontFamily,
        ...(task.status === 'cancelled' ? { 'text-decoration': 'line-through', opacity: '0.6' } : {}),
      }));

      if (!task.computedStart || !task.computedEnd) continue;

      const barX = dateToX(task.computedStart);
      const barW = Math.max(4, dateToX(task.computedEnd) - barX);
      const color = isDark ? STATUS_DARK[task.status] : STATUS_COLORS[task.status];

      // Bar
      parts.push(rect(barX, barY, barW, barH, {
        fill: color,
        rx: '3',
        opacity: task.status === 'cancelled' ? '0.4' : '0.85',
        'clip-path': 'url(#chart-clip)',
      }));

      // Blocked diagonal stripe overlay
      if (task.status === 'blocked') {
        parts.push(rect(barX, barY, barW, barH, {
          fill: 'url(#blocked-stripe)',
          rx: '3',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Cancelled strikethrough
      if (task.status === 'cancelled') {
        parts.push(line(barX, midY, barX + barW, midY, {
          stroke: isDark ? '#6b7280' : '#374151',
          'stroke-width': '2',
          opacity: '0.7',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Progress fill
      if (task.progress !== undefined && task.progress > 0) {
        const progW = barW * (task.progress / 100);
        parts.push(rect(barX, barY, progW, barH, {
          fill: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.2)',
          rx: '3',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // +delayed:X — ghost bar at original planned position, orange accent on actual bar
      const delayedMod = task.modifiers.find(m => m.startsWith('delayed'));
      if (delayedMod) {
        if (task.plannedStart && task.plannedEnd) {
          // Real ghost: draw faded bar at the original undelayed position
          const ghostX = dateToX(task.plannedStart);
          const ghostW = Math.max(4, dateToX(task.plannedEnd) - ghostX);
          parts.push(rect(ghostX, barY + barH * 0.15, ghostW, barH * 0.7, {
            fill: '#f59e0b',
            rx: '3',
            opacity: '0.25',
            'clip-path': 'url(#chart-clip)',
          }));
          // Dashed outline on ghost
          parts.push(rect(ghostX, barY + barH * 0.15, ghostW, barH * 0.7, {
            fill: 'none',
            stroke: '#f59e0b',
            'stroke-width': '1',
            'stroke-dasharray': '3,2',
            rx: '3',
            opacity: '0.6',
            'clip-path': 'url(#chart-clip)',
          }));
        }
        // Orange left-edge accent on the actual (delayed) bar
        parts.push(rect(barX, barY, 3, barH, {
          fill: '#f59e0b',
          rx: '1',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Deadline hairline
      if (task.modifiers.includes('deadline') && task.dueDate) {
        const dlX = dateToX(new Date(task.dueDate + 'T00:00:00Z'));
        parts.push(line(dlX, rowY + 2, dlX, rowY + opts.rowHeight - 2, {
          stroke: '#ef4444',
          'stroke-width': '2',
          'stroke-dasharray': '3,2',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Assignee circles
      if (task.assignees.length > 0) {
        const maxCircles = 3;
        const shown = task.assignees.slice(0, maxCircles);
        const circleR = 9;
        let cx = barX + barW - circleR - 2;
        const cy = midY;
        for (let ai = shown.length - 1; ai >= 0; ai--) {
          const assignee = shown[ai];
          parts.push(`<circle cx="${cx}" cy="${cy}" r="${circleR}" fill="${isDark ? '#334155' : '#fff'}" stroke="${color}" stroke-width="1.5" clip-path="url(#chart-clip)"/>`);
          parts.push(text(cx, cy + 3.5, initials(assignee), {
            fill: isDark ? '#e2e8f0' : '#1e293b',
            'font-size': '8',
            'font-weight': '600',
            'text-anchor': 'middle',
            'font-family': opts.fontFamily,
            'clip-path': 'url(#chart-clip)',
          }));
          cx -= circleR * 1.6;
        }
      }

      // Bar label (task name inside/beside bar if wide enough)
      if (barW > 60) {
        parts.push(text(barX + 6, midY + 4, task.name.length > 20 ? task.name.slice(0, 18) + '…' : task.name, {
          fill: '#fff',
          'font-size': '10',
          'font-family': opts.fontFamily,
          opacity: '0.9',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      // Transparent clickable overlay for the whole row (enables task edit on click)
      if (task.description) {
        parts.push(`<rect x="0" y="${rowY}" width="${opts.width}" height="${opts.rowHeight}" fill="transparent" data-line="${task.line}" style="cursor:pointer"><title>${escapeXml(task.description)}</title></rect>`);
      } else {
        parts.push(rect(0, rowY, opts.width, opts.rowHeight, {
          fill: 'transparent',
          'data-line': task.line,
          style: 'cursor:pointer',
        }));
      }
    }

    if (row.kind === 'milestone' && row.milestone) {
      const ms = row.milestone;
      const indent = row.depth * 16 + opts.padding;

      // Label
      const labelText = ms.name.length > 28 ? ms.name.slice(0, 26) + '…' : ms.name;
      parts.push(text(indent + 16, midY + 4, labelText, {
        fill: textColor,
        'font-size': '12',
        'font-style': 'italic',
        'font-family': opts.fontFamily,
      }));

      if (!ms.computedDate) continue;
      const dmx = dateToX(ms.computedDate);
      const dmSize = opts.rowHeight * 0.5;

      // +deadline milestone: full-height red hairline
      if (ms.modifiers.includes('deadline')) {
        parts.push(line(dmx, opts.headerHeight, dmx, totalHeight, {
          stroke: '#ef4444',
          'stroke-width': '1',
          opacity: '0.35',
          'stroke-dasharray': '4,3',
          'clip-path': 'url(#chart-clip)',
        }));
      }

      parts.push(diamond(dmx, midY, dmSize, isDark ? '#fbbf24' : '#d97706'));
      // Milestone label
      parts.push(text(dmx + dmSize / 2 + 4, midY + 4, ms.name.slice(0, 18), {
        fill: isDark ? '#fbbf24' : '#92400e',
        'font-size': '10',
        'font-weight': '600',
        'font-family': opts.fontFamily,
        'clip-path': 'url(#chart-clip)',
      }));
    }
  }

  // ── Today line ─────────────────────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (today >= minDate && today <= maxDate) {
    const tx = dateToX(today);
    parts.push(line(tx, opts.headerHeight, tx, totalHeight, {
      stroke: '#ef4444',
      'stroke-width': '1.5',
      opacity: '0.7',
      'stroke-dasharray': '4,3',
    }));
    parts.push(text(tx + 3, opts.headerHeight - 4, 'Today', {
      fill: '#ef4444',
      'font-size': '10',
      'font-family': opts.fontFamily,
    }));
  }

  // ── Separator line between label and chart ─────────────────────────────────
  parts.push(line(chartLeft, 0, chartLeft, totalHeight, {
    stroke: gridColor,
    'stroke-width': '1',
  }));

  const svgContent = parts.join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${totalHeight}" viewBox="0 0 ${opts.width} ${totalHeight}" font-family="${opts.fontFamily}">
${svgContent}
</svg>`;
}
