import { YattDocument, Task, Milestone, ParallelBlock, DocumentItem, Status, Priority } from '../types.js';

export interface ListOptions {
  title?: string;
  showSubtasks?: boolean;
  theme?: 'light' | 'dark';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_EMOJI: Record<Status, string> = {
  new:       '⬜',
  active:    '🔵',
  done:      '✅',
  blocked:   '🔴',
  'at-risk': '🟡',
  deferred:  '🟣',
  cancelled: '⬛',
  review:    '🟪',
  paused:    '⏸️',
};

const STATUS_LABEL: Record<Status, string> = {
  new:       'New',
  active:    'Active',
  done:      'Done',
  blocked:   'Blocked',
  'at-risk': 'At Risk',
  deferred:  'Deferred',
  cancelled: 'Cancelled',
  review:    'Review',
  paused:    'Paused',
};

const STATUS_COLOR: Record<Status, string> = {
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

const PRIORITY_COLOR: Record<Priority, string> = {
  low:      '#94a3b8',
  normal:   '#64748b',
  high:     '#f59e0b',
  critical: '#ef4444',
};

function formatDate(d?: Date): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 10);
}

function renderTaskRow(task: Task, depth: number, opts: ListOptions): string {
  const indent = depth * 20;
  const cancelled = task.status === 'cancelled';
  const strikeStyle = cancelled ? 'text-decoration:line-through;opacity:0.6;' : '';

  const progress = task.progress ?? (task.status === 'done' ? 100 : undefined);
  const progressBar = progress !== undefined
    ? `<div class="progress-bar"><div class="progress-fill" style="width:${progress}%;background:${STATUS_COLOR[task.status]}"></div></div>`
    : '';

  const assigneeBadges = task.assignees
    .map(a => `<span class="assignee">@${escapeHtml(a)}</span>`)
    .join('');

  const tagBadges = task.tags
    .map(t => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join('');

  const priorityBadge = task.priority
    ? `<span class="priority" style="background:${PRIORITY_COLOR[task.priority]}">${task.priority}</span>`
    : '';

  const statusBadge = `<span class="status-badge" style="background:${STATUS_COLOR[task.status]}">${STATUS_LABEL[task.status]}</span>`;

  const externalRef = task.externalRef
    ? `<span class="ext-ref">${escapeHtml(task.externalRef)}</span>`
    : '';

  let row = `
  <tr class="task-row depth-${depth}">
    <td class="name-cell" style="padding-left:${16 + indent}px">
      <span class="status-icon" title="${STATUS_LABEL[task.status]}">${STATUS_EMOJI[task.status]}</span>
      <span style="${strikeStyle}">${escapeHtml(task.name)}</span>
    </td>
    <td>${statusBadge}</td>
    <td>${assigneeBadges}</td>
    <td class="date-cell">${formatDate(task.computedStart)}</td>
    <td class="date-cell">${task.dueDate ?? formatDate(task.computedEnd)}</td>
    <td>${progressBar}${progress !== undefined ? `<span class="progress-text">${progress}%</span>` : ''}</td>
    <td>${priorityBadge}</td>
    <td>${tagBadges} ${externalRef}</td>
  </tr>`;

  if (opts.showSubtasks !== false && task.subtasks.length > 0) {
    for (const sub of task.subtasks) {
      row += renderTaskRow(sub, depth + 1, opts);
    }
  }

  return row;
}

function renderMilestoneRow(ms: Milestone): string {
  return `
  <tr class="milestone-row">
    <td class="name-cell" style="padding-left:16px">
      <span class="milestone-icon">◆</span>
      <em>${escapeHtml(ms.name)}</em>
    </td>
    <td><span class="status-badge milestone-badge">Milestone</span></td>
    <td>—</td>
    <td class="date-cell">${formatDate(ms.computedDate)}</td>
    <td class="date-cell">—</td>
    <td>—</td>
    <td>—</td>
    <td>${ms.modifiers.map(m => `<span class="modifier">+${escapeHtml(m)}</span>`).join('')}</td>
  </tr>`;
}

function renderItems(items: Array<DocumentItem | Task>, opts: ListOptions, rows: string[]): void {
  for (const item of items) {
    if (item.type === 'section') {
      const tag = item.level === 2 ? 'h3' : 'h2';
      rows.push(`<tr class="section-row"><td colspan="8"><${tag}>${escapeHtml(item.title)}</${tag}></td></tr>`);
    } else if (item.type === 'task') {
      rows.push(renderTaskRow(item, 0, opts));
    } else if (item.type === 'milestone') {
      rows.push(renderMilestoneRow(item));
    } else if (item.type === 'parallel') {
      rows.push(`<tr class="parallel-header-row"><td colspan="8"><div class="parallel-label">⇉ Parallel: ${escapeHtml(item.name ?? '(anonymous)')}</div></td></tr>`);
      renderItems(item.items as Array<DocumentItem>, opts, rows);
    }
    // comments: skip
  }
}

export function renderListHTML(doc: YattDocument, options?: ListOptions): string {
  const opts: ListOptions = { showSubtasks: true, theme: 'light', ...options };
  const isDark = opts.theme === 'dark';

  const title = options?.title ?? doc.header.title ?? 'Task List';

  const css = `
  <style>
    .yatt-list { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: ${isDark ? '#e2e8f0' : '#1e293b'}; background: ${isDark ? '#1e293b' : '#fff'}; }
    .yatt-list h1 { font-size: 18px; font-weight: 700; padding: 12px 16px; margin: 0; border-bottom: 1px solid ${isDark ? '#334155' : '#e2e8f0'}; }
    .yatt-list table { width: 100%; border-collapse: collapse; }
    .yatt-list th { background: ${isDark ? '#0f172a' : '#f8fafc'}; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${isDark ? '#94a3b8' : '#64748b'}; border-bottom: 1px solid ${isDark ? '#334155' : '#e2e8f0'}; }
    .yatt-list td { padding: 7px 10px; border-bottom: 1px solid ${isDark ? '#1e293b' : '#f1f5f9'}; vertical-align: middle; }
    .yatt-list tr:hover td { background: ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)'}; }
    .name-cell { display: flex; align-items: center; gap: 6px; min-width: 200px; }
    .status-icon { font-size: 14px; }
    .milestone-icon { color: #d97706; font-size: 12px; }
    .status-badge { display: inline-block; padding: 2px 7px; border-radius: 9999px; font-size: 10px; font-weight: 600; color: #fff; white-space: nowrap; }
    .milestone-badge { background: #d97706 !important; }
    .assignee { display: inline-block; background: ${isDark ? '#1e3a5f' : '#eff6ff'}; color: ${isDark ? '#93c5fd' : '#1d4ed8'}; border-radius: 3px; padding: 1px 5px; font-size: 11px; margin: 1px; }
    .tag { display: inline-block; background: ${isDark ? '#1a2535' : '#f0fdf4'}; color: ${isDark ? '#86efac' : '#166534'}; border-radius: 3px; padding: 1px 5px; font-size: 11px; margin: 1px; }
    .priority { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; color: #fff; text-transform: uppercase; }
    .ext-ref { display: inline-block; background: ${isDark ? '#292524' : '#fef3c7'}; color: ${isDark ? '#fbbf24' : '#92400e'}; border-radius: 3px; padding: 1px 5px; font-size: 11px; margin: 1px; }
    .modifier { display: inline-block; background: ${isDark ? '#1e293b' : '#f8fafc'}; color: ${isDark ? '#94a3b8' : '#475569'}; border-radius: 3px; padding: 1px 5px; font-size: 11px; margin: 1px; border: 1px solid ${isDark ? '#334155' : '#e2e8f0'}; }
    .progress-bar { display: inline-block; width: 60px; height: 6px; background: ${isDark ? '#334155' : '#e2e8f0'}; border-radius: 3px; vertical-align: middle; overflow: hidden; margin-right: 4px; }
    .progress-fill { height: 100%; border-radius: 3px; }
    .progress-text { font-size: 11px; color: ${isDark ? '#94a3b8' : '#64748b'}; }
    .date-cell { font-size: 11px; color: ${isDark ? '#94a3b8' : '#64748b'}; white-space: nowrap; }
    .section-row td { background: ${isDark ? '#0f172a' : '#f8fafc'}; padding: 4px 16px; }
    .section-row h2 { font-size: 14px; font-weight: 700; margin: 0; color: ${isDark ? '#e2e8f0' : '#0f172a'}; }
    .section-row h3 { font-size: 13px; font-weight: 600; margin: 0; color: ${isDark ? '#cbd5e1' : '#334155'}; }
    .parallel-header-row td { background: ${isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)'}; padding: 4px 16px; }
    .parallel-label { font-size: 12px; font-weight: 600; color: ${isDark ? '#818cf8' : '#4f46e5'}; }
    .depth-1 td:first-child { padding-left: 36px !important; }
    .depth-2 td:first-child { padding-left: 56px !important; }
    .depth-3 td:first-child { padding-left: 76px !important; }
  </style>`;

  const rows: string[] = [];
  renderItems(doc.items as Array<DocumentItem>, opts, rows);

  const ownerInfo = doc.header.owner ? ` — <small>${escapeHtml(doc.header.owner)}</small>` : '';
  const startInfo = doc.header.start ? ` <small style="color:${isDark ? '#94a3b8' : '#64748b'}">Start: ${doc.header.start}</small>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${css}
</head>
<body>
<div class="yatt-list">
  <h1>${escapeHtml(title)}${ownerInfo}${startInfo}</h1>
  <table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Status</th>
        <th>Assignees</th>
        <th>Start</th>
        <th>Due / End</th>
        <th>Progress</th>
        <th>Priority</th>
        <th>Tags / Refs</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('\n')}
    </tbody>
  </table>
</div>
</body>
</html>`;
}
