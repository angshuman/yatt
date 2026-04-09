import { parse } from '../parser.js';
import { validate } from '../validator.js';
import { schedule } from '../scheduler.js';
import { renderGanttSVG } from './gantt-svg.js';
import type { Dependency, DocumentItem, Duration, ParseError, Status, Task, YattDocument } from '../types.js';

export interface InteractiveControlOptions {
  initialView?: 'timeline' | 'kanban' | 'people' | 'edit';
  editable?: boolean;
  allowPopup?: boolean;
  theme?: 'light' | 'dark';
  onChange?: (nextSource: string) => void;
}

export interface InteractiveControlHandle {
  getSource: () => string;
  updateSource: (nextSource: string) => void;
  destroy: () => void;
}

interface FlatTask {
  line: number;
  depth: number;
  name: string;
  status: Status;
  assignees: string[];
  tags: string[];
  priority?: Task['priority'];
  progress?: number;
  duration?: string;
  startDate?: string;
  dueDate?: string;
  id?: string;
  after: string;
  modifiers: string[];
  description?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  active: 'Active',
  done: 'Done',
  blocked: 'Blocked',
  'at-risk': 'At Risk',
  deferred: 'Deferred',
  cancelled: 'Cancelled',
  review: 'Review',
  paused: 'Paused',
};

const STATUS_COLOR: Record<Status, string> = {
  new: '#7d8590',
  active: '#388bfd',
  done: '#3fb950',
  blocked: '#f85149',
  'at-risk': '#f0883e',
  deferred: '#bc8cff',
  cancelled: '#30363d',
  review: '#d29922',
  paused: '#484f58',
};

const KANBAN_COLS: Status[] = ['new', 'active', 'review', 'blocked', 'paused', 'done', 'cancelled'];

const STATUS_SIGIL: Record<Status, string> = {
  new: ' ',
  active: '~',
  done: 'x',
  blocked: '!',
  'at-risk': '?',
  deferred: '>',
  cancelled: '_',
  review: '=',
  paused: 'o',
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function durationToString(d?: Duration): string {
  return d ? `${d.value}${d.unit}` : '';
}

function afterToString(after: Dependency[]): string {
  if (!after.length) return '';
  return after
    .map((d) => d.ids.join(d.logic === 'or' ? '|' : ','))
    .join(',');
}

function flattenTasks(items: DocumentItem[], out: FlatTask[], depth = 0): void {
  for (const item of items) {
    if (item.type === 'task') {
      out.push({
        line: item.line,
        depth,
        name: item.name,
        status: item.status,
        assignees: [...item.assignees],
        tags: [...item.tags],
        priority: item.priority,
        progress: item.progress,
        duration: durationToString(item.duration),
        startDate: item.startDate,
        dueDate: item.dueDate,
        id: item.id,
        after: afterToString(item.after),
        modifiers: [...item.modifiers],
        description: item.description,
      });
      if (item.subtasks.length) {
        flattenTasks(item.subtasks as unknown as DocumentItem[], out, depth + 1);
      }
    } else if (item.type === 'parallel') {
      flattenTasks(item.items as DocumentItem[], out, depth);
    }
  }
}

function serializeTaskLine(t: FlatTask): string {
  const sig = STATUS_SIGIL[t.status] ?? ' ';
  const head = `[${sig}] ${t.name ?? ''}`;
  const fields: string[] = [];
  if (t.id) fields.push(`id:${t.id}`);
  if (t.duration) fields.push(t.duration);
  if (t.assignees.length) fields.push(t.assignees.map((a) => `@${a}`).join(' '));
  if (t.tags.length) fields.push(t.tags.map((a) => `#${a}`).join(' '));
  if (t.priority && t.priority !== 'normal') fields.push(`!${t.priority}`);
  if (t.progress != null) fields.push(`%${t.progress}`);
  if (t.startDate) fields.push(`>${t.startDate}`);
  if (t.dueDate) fields.push(`<${t.dueDate}`);
  if (t.after) fields.push(`after:${t.after}`);
  for (const m of t.modifiers) {
    const shiftMatch = m.match(/^(delayed|blocked):(.+)$/);
    if (shiftMatch) fields.push(`${shiftMatch[1]} ${shiftMatch[2]}`);
    else fields.push(`+${m}`);
  }
  return head + (fields.length ? ` | ${fields.join(' | ')}` : '');
}

function patchSourceWithDescription(source: string, lineNum: number, newLine: string, descText?: string): string {
  const lines = source.split('\n');
  if (lineNum < 1 || lineNum > lines.length) return source;
  let oldDescCount = 0;
  let idx = lineNum;
  while (idx < lines.length && lines[idx].trimStart().startsWith('//')) {
    oldDescCount++;
    idx++;
  }
  const newLines = [newLine];
  if (descText && descText.trim()) {
    for (const dl of descText.trim().split('\n')) {
      newLines.push(`// ${dl.trim()}`);
    }
  }
  lines.splice(lineNum - 1, 1 + oldDescCount, ...newLines);
  return lines.join('\n');
}

function shiftBadges(task: FlatTask): string {
  let html = '';
  for (const m of task.modifiers) {
    const dm = m.match(/^(delayed|blocked):(.+)$/);
    if (dm) {
      const icon = dm[1] === 'delayed' ? 'Late' : 'Blocked';
      html += `<span class="yattc-shift-badge ${dm[1]}">${icon} ${esc(dm[2])}</span>`;
    }
  }
  return html;
}

function avatar(name: string): string {
  const clean = name.replace(/[^a-zA-Z]/g, '');
  const init = (clean.slice(0, 2) || name.slice(0, 2)).toUpperCase();
  return `<span class="yattc-avatar" title="@${esc(name)}">${esc(init)}</span>`;
}

function buildKanbanHtml(tasks: FlatTask[]): string {
  const byStatus = new Map<Status, FlatTask[]>();
  for (const status of KANBAN_COLS) byStatus.set(status, []);
  for (const task of tasks) {
    const col = byStatus.get(task.status) ?? [];
    col.push(task);
    byStatus.set(task.status, col);
  }
  let html = '';
  for (const status of KANBAN_COLS) {
    const cards = byStatus.get(status) ?? [];
    const color = STATUS_COLOR[status];
    const label = STATUS_LABEL[status];
    html += `<div class="yattc-k-col" data-status="${esc(status)}"><div class="yattc-k-head"><span class="yattc-k-line" style="background:${color}"></span><span>${esc(label)}</span><span class="yattc-k-count">${cards.length}</span></div><div class="yattc-k-cards">`;
    for (const t of cards) {
      html += `<div class="yattc-k-card" data-line="${t.line}" style="padding-left:${8 + t.depth * 10}px"><div class="yattc-k-name">${esc(t.name)}</div>${t.description ? `<div class="yattc-k-desc">${esc(t.description)}</div>` : ''}<div class="yattc-k-meta">${t.assignees.slice(0, 3).map(avatar).join('')}${t.priority && t.priority !== 'normal' ? `<span class="yattc-pri">${esc(t.priority)}</span>` : ''}</div>${shiftBadges(t)}${t.progress != null ? `<div class="yattc-k-prog"><div class="yattc-k-prog-fill" style="width:${t.progress}%"></div></div>` : ''}</div>`;
    }
    html += '</div></div>';
  }
  return html;
}

function buildPeopleHtml(tasks: FlatTask[]): string {
  const byPerson = new Map<string, FlatTask[]>();
  for (const t of tasks) {
    const people = t.assignees.length ? t.assignees : ['(unassigned)'];
    for (const p of people) {
      const list = byPerson.get(p) ?? [];
      list.push(t);
      byPerson.set(p, list);
    }
  }
  const names = [...byPerson.keys()].sort((a, b) => {
    if (a === '(unassigned)') return 1;
    if (b === '(unassigned)') return -1;
    return a.localeCompare(b);
  });
  if (!names.length) return '<div class="yattc-empty">No tasks.</div>';
  let html = '';
  for (const name of names) {
    const list = byPerson.get(name) ?? [];
    html += `<div class="yattc-p-card"><div class="yattc-p-head">${name === '(unassigned)' ? '' : avatar(name)}<div><div class="yattc-p-name">${esc(name === '(unassigned)' ? 'Unassigned' : `@${name}`)}</div><div class="yattc-p-count">${list.length} task${list.length === 1 ? '' : 's'}</div></div></div>`;
    for (const t of list) {
      html += `<div class="yattc-p-task" data-line="${t.line}"><span class="yattc-dot" style="background:${STATUS_COLOR[t.status]}"></span><span class="yattc-p-task-name">${esc(t.name)}</span>${t.progress != null ? `<span class="yattc-p-prog">${t.progress}%</span>` : ''}</div>`;
    }
    html += '</div>';
  }
  return html;
}

function controlCss(theme: 'light' | 'dark'): string {
  const dark = theme === 'dark';
  return `
.yattc{font-family:ui-sans-serif,system-ui,sans-serif;border:1px solid ${dark ? '#30363d' : '#e5e7eb'};border-radius:8px;overflow:hidden;background:${dark ? '#0d1117' : '#fff'};color:${dark ? '#c9d1d9' : '#111827'}}
.yattc-errors{padding:10px 12px;font-size:12px;color:${dark ? '#ffa198' : '#b91c1c'};border-bottom:1px solid ${dark ? '#30363d' : '#e5e7eb'}}
.yattc-tabs{display:flex;gap:2px;padding:6px;background:${dark ? '#010409' : '#f8fafc'};border-bottom:1px solid ${dark ? '#30363d' : '#e5e7eb'}}
.yattc-tab{background:none;border:none;color:inherit;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px}
.yattc-tab.active{background:${dark ? 'rgba(56,139,253,.2)' : 'rgba(59,130,246,.12)'};color:${dark ? '#58a6ff' : '#2563eb'}}
.yattc-panel{display:none}
.yattc-panel.active{display:block}
.yattc-panel-timeline{overflow:auto;padding:8px}
.yattc-panel-kanban{overflow:auto;padding:10px}
.yattc-panel-people{padding:10px}
.yattc-panel-edit{padding:10px}
.yattc-k-wrap{display:flex;gap:10px;align-items:flex-start;min-height:140px}
.yattc-k-col{min-width:220px;max-width:280px;flex:1;border:1px solid ${dark ? '#30363d' : '#e5e7eb'};border-radius:8px;background:${dark ? '#161b22' : '#f9fafb'}}
.yattc-k-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ${dark ? '#30363d' : '#e5e7eb'};font-size:12px}
.yattc-k-line{width:4px;height:12px;border-radius:999px}
.yattc-k-count{margin-left:auto;opacity:.8}
.yattc-k-cards{padding:8px;display:flex;flex-direction:column;gap:8px;min-height:40px}
.yattc-k-card{border:1px solid ${dark ? '#30363d' : '#d1d5db'};border-radius:6px;padding:8px;background:${dark ? '#0d1117' : '#fff'};cursor:pointer}
.yattc-k-card.dragging{opacity:.45}
.yattc-k-col.drag-over{outline:2px dashed ${dark ? '#58a6ff' : '#2563eb'}}
.yattc-k-name{font-size:13px;font-weight:600}
.yattc-k-desc{font-size:11px;opacity:.8;margin-top:4px}
.yattc-k-meta{display:flex;gap:4px;align-items:center;margin-top:6px}
.yattc-pri{margin-left:auto;font-size:10px;text-transform:uppercase;opacity:.8}
.yattc-k-prog{height:5px;background:${dark ? '#30363d' : '#e5e7eb'};border-radius:999px;margin-top:8px;overflow:hidden}
.yattc-k-prog-fill{height:100%;background:#388bfd}
.yattc-avatar{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:${dark ? '#1f2937' : '#e5e7eb'};font-size:10px}
.yattc-shift-badge{display:inline-block;font-size:10px;padding:2px 5px;border-radius:999px;margin-top:6px;margin-right:4px}
.yattc-shift-badge.delayed{background:${dark ? '#3f2d12' : '#fef3c7'};color:${dark ? '#f7b955' : '#92400e'}}
.yattc-shift-badge.blocked{background:${dark ? '#3a1a1a' : '#fee2e2'};color:${dark ? '#ff8d8d' : '#991b1b'}}
.yattc-p-card{border:1px solid ${dark ? '#30363d' : '#e5e7eb'};border-radius:8px;padding:10px;margin-bottom:10px}
.yattc-p-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.yattc-p-name{font-size:13px;font-weight:700}
.yattc-p-count{font-size:11px;opacity:.75}
.yattc-p-task{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:4px;cursor:pointer}
.yattc-p-task:hover{background:${dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.03)'}}
.yattc-dot{width:8px;height:8px;border-radius:999px}
.yattc-p-task-name{flex:1;font-size:12px}
.yattc-p-prog{font-size:11px;opacity:.75}
.yattc-edit{width:100%;height:220px;border:1px solid ${dark ? '#30363d' : '#d1d5db'};border-radius:6px;background:${dark ? '#0d1117' : '#fff'};color:inherit;padding:8px;font:12px ui-monospace,Consolas,monospace}
.yattc-edit-bar{display:flex;justify-content:flex-end;margin-top:8px}
.yattc-btn{border:1px solid ${dark ? '#30363d' : '#d1d5db'};background:${dark ? '#21262d' : '#fff'};color:inherit;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.yattc-empty{padding:10px;font-size:12px;opacity:.75}
.yattc-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;z-index:9999}
.yattc-modal-overlay.open{display:flex;align-items:center;justify-content:center}
.yattc-modal{width:min(760px,95vw);max-height:92vh;overflow:auto;background:${dark ? '#0d1117' : '#fff'};border:1px solid ${dark ? '#30363d' : '#d1d5db'};border-radius:8px;padding:12px}
.yattc-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.yattc-modal-grid input,.yattc-modal-grid select,.yattc-modal-grid textarea{width:100%;border:1px solid ${dark ? '#30363d' : '#d1d5db'};border-radius:6px;background:${dark ? '#010409' : '#fff'};color:inherit;padding:6px;font-size:12px}
.yattc-modal-grid textarea{min-height:72px}
.yattc-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
`;
}

export function mountInteractiveControl(
  root: HTMLElement,
  source: string,
  options?: InteractiveControlOptions,
): InteractiveControlHandle {
  const opts: Required<Pick<InteractiveControlOptions, 'editable' | 'allowPopup' | 'theme'>> & InteractiveControlOptions = {
    editable: options?.editable ?? true,
    allowPopup: options?.allowPopup ?? true,
    theme: options?.theme ?? 'light',
    ...options,
  };

  let currentSource = source;
  let currentView: NonNullable<InteractiveControlOptions['initialView']> = opts.initialView ?? 'timeline';
  let tasks: FlatTask[] = [];

  const emitChange = () => {
    opts.onChange?.(currentSource);
    root.dispatchEvent(new CustomEvent('yatt:change', { detail: { source: currentSource } }));
  };

  const rerender = () => {
    const parsed = parse(currentSource);
    const validationErrors = validate(parsed.doc);
    const errors = [...parsed.errors, ...validationErrors];
    const doc: YattDocument = schedule(parsed.doc);
    tasks = [];
    flattenTasks(doc.items, tasks);

    const showEdit = opts.editable;
    const showPopup = opts.allowPopup && opts.editable;
    const tabs = [
      ['timeline', 'Timeline'],
      ['kanban', 'Kanban'],
      ['people', 'People'],
      ...(showEdit ? [['edit', 'Edit']] : []),
    ];
    if (!tabs.some((t) => t[0] === currentView)) currentView = 'timeline';

    root.innerHTML = `
<div class="yattc">
  <style>${controlCss(opts.theme)}</style>
  ${errors.length ? `<div class="yattc-errors">${errors.map((e: ParseError) => `Line ${e.line}: ${esc(e.message)}`).join('<br>')}</div>` : ''}
  <div class="yattc-tabs">${tabs
    .map(([id, label]) => `<button class="yattc-tab ${currentView === id ? 'active' : ''}" data-panel="${id}">${label}</button>`)
    .join('')}</div>
  <div class="yattc-panel yattc-panel-timeline ${currentView === 'timeline' ? 'active' : ''}" data-panel="timeline">${renderGanttSVG(doc, { theme: opts.theme })}</div>
  <div class="yattc-panel yattc-panel-kanban ${currentView === 'kanban' ? 'active' : ''}" data-panel="kanban"><div class="yattc-k-wrap">${buildKanbanHtml(tasks)}</div></div>
  <div class="yattc-panel yattc-panel-people ${currentView === 'people' ? 'active' : ''}" data-panel="people">${buildPeopleHtml(tasks)}</div>
  ${
    showEdit
      ? `<div class="yattc-panel yattc-panel-edit ${currentView === 'edit' ? 'active' : ''}" data-panel="edit"><textarea class="yattc-edit" spellcheck="false">${esc(
          currentSource,
        )}</textarea><div class="yattc-edit-bar"><button class="yattc-btn yattc-apply">Apply</button></div></div>`
      : ''
  }
</div>
${
  showPopup
    ? `<div class="yattc-modal-overlay"><div class="yattc-modal"><div class="yattc-modal-grid">
      <label>Name<input type="text" data-f="name"></label>
      <label>Status<select data-f="status">${Object.entries(STATUS_LABEL)
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join('')}</select></label>
      <label>Assignees<input type="text" data-f="assignees" placeholder="@alice @bob"></label>
      <label>Tags<input type="text" data-f="tags" placeholder="#backend #api"></label>
      <label>Priority<select data-f="priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      <label>Progress<input type="number" data-f="progress" min="0" max="100"></label>
      <label>Duration<input type="text" data-f="duration" placeholder="5d"></label>
      <label>ID<input type="text" data-f="id"></label>
      <label>Start Date<input type="text" data-f="startDate" placeholder="YYYY-MM-DD"></label>
      <label>Due Date<input type="text" data-f="dueDate" placeholder="YYYY-MM-DD"></label>
      <label>After<input type="text" data-f="after" placeholder="id1,id2"></label>
      <label>Delayed<input type="text" data-f="delayed" placeholder="3d"></label>
      <label>Blocked<input type="text" data-f="blocked" placeholder="2w"></label>
      <label style="grid-column:1/-1">Description<textarea data-f="description"></textarea></label>
    </div><div class="yattc-modal-actions"><button class="yattc-btn yattc-cancel">Cancel</button><button class="yattc-btn yattc-save">Save</button></div></div></div>`
    : ''
}
`;

    const setPanel = (panel: string) => {
      currentView = panel as NonNullable<InteractiveControlOptions['initialView']>;
      root.querySelectorAll<HTMLElement>('.yattc-tab').forEach((el) => {
        el.classList.toggle('active', el.dataset.panel === panel);
      });
      root.querySelectorAll<HTMLElement>('.yattc-panel').forEach((el) => {
        el.classList.toggle('active', el.dataset.panel === panel);
      });
    };
    root.querySelectorAll<HTMLElement>('.yattc-tab').forEach((btn) => {
      btn.addEventListener('click', () => setPanel(btn.dataset.panel ?? 'timeline'));
    });

    const findTask = (line: number) => tasks.find((t) => t.line === line);

    const showModalFor = (task: FlatTask) => {
      if (!showPopup) return;
      const overlay = root.querySelector<HTMLElement>('.yattc-modal-overlay');
      if (!overlay) return;
      const set = (field: string, value: string) => {
        const el = overlay.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-f="${field}"]`);
        if (el) el.value = value;
      };
      set('name', task.name ?? '');
      set('status', task.status ?? 'new');
      set('assignees', task.assignees.map((a) => `@${a}`).join(' '));
      set('tags', task.tags.map((a) => `#${a}`).join(' '));
      set('priority', task.priority ?? 'normal');
      set('progress', task.progress != null ? String(task.progress) : '');
      set('duration', task.duration ?? '');
      set('id', task.id ?? '');
      set('startDate', task.startDate ?? '');
      set('dueDate', task.dueDate ?? '');
      set('after', task.after ?? '');
      set('description', task.description ?? '');
      set('delayed', task.modifiers.find((m) => m.startsWith('delayed:'))?.slice(8) ?? '');
      set('blocked', task.modifiers.find((m) => m.startsWith('blocked:'))?.slice(8) ?? '');
      overlay.classList.add('open');

      const read = (field: string) => {
        const el = overlay.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-f="${field}"]`);
        return el?.value?.trim() ?? '';
      };

      const save = () => {
        const updated: FlatTask = { ...task };
        updated.name = read('name');
        updated.status = (read('status') || 'new') as Status;
        updated.assignees = read('assignees')
          .split(/\s+/)
          .map((v) => v.replace(/^@/, ''))
          .filter(Boolean);
        updated.tags = read('tags')
          .split(/\s+/)
          .map((v) => v.replace(/^#/, ''))
          .filter(Boolean);
        updated.priority = (read('priority') || 'normal') as Task['priority'];
        const progressRaw = read('progress');
        updated.progress = progressRaw === '' ? undefined : Math.max(0, Math.min(100, Number(progressRaw)));
        updated.duration = read('duration') || undefined;
        updated.id = read('id') || undefined;
        updated.startDate = read('startDate') || undefined;
        updated.dueDate = read('dueDate') || undefined;
        updated.after = read('after') || '';
        updated.description = read('description') || undefined;
        const baseMods = updated.modifiers.filter((m) => !m.startsWith('delayed:') && !m.startsWith('blocked:'));
        const delayed = read('delayed');
        const blocked = read('blocked');
        if (delayed) baseMods.push(`delayed:${delayed}`);
        if (blocked) baseMods.push(`blocked:${blocked}`);
        updated.modifiers = baseMods;
        currentSource = patchSourceWithDescription(currentSource, task.line, serializeTaskLine(updated), updated.description);
        overlay.classList.remove('open');
        emitChange();
        rerender();
      };

      overlay.querySelector('.yattc-save')?.addEventListener('click', save, { once: true });
      overlay.querySelector('.yattc-cancel')?.addEventListener('click', () => overlay.classList.remove('open'), { once: true });
      overlay.addEventListener(
        'click',
        (e) => {
          if (e.target === overlay) overlay.classList.remove('open');
        },
        { once: true },
      );
    };

    root.querySelector<HTMLElement>('[data-panel="timeline"] svg')?.addEventListener('click', (e) => {
      const lineAttr = (e.target as HTMLElement).closest('[data-line]')?.getAttribute('data-line');
      if (!lineAttr) return;
      const task = findTask(Number(lineAttr));
      if (task) showModalFor(task);
    });

    root.querySelectorAll<HTMLElement>('.yattc-p-task[data-line]').forEach((el) => {
      el.addEventListener('click', () => {
        const line = Number(el.dataset.line);
        const task = findTask(line);
        if (task) showModalFor(task);
      });
    });

    const kanbanRoot = root.querySelector<HTMLElement>('.yattc-k-wrap');
    if (kanbanRoot && opts.editable) {
      let draggingLine: number | null = null;
      kanbanRoot.querySelectorAll<HTMLElement>('.yattc-k-card[data-line]').forEach((card) => {
        card.setAttribute('draggable', 'true');
        card.addEventListener('click', () => {
          const task = findTask(Number(card.dataset.line));
          if (task) showModalFor(task);
        });
        card.addEventListener('dragstart', () => {
          card.classList.add('dragging');
          draggingLine = Number(card.dataset.line);
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          draggingLine = null;
        });
      });
      kanbanRoot.querySelectorAll<HTMLElement>('.yattc-k-col[data-status]').forEach((col) => {
        const nextStatus = col.dataset.status as Status;
        col.addEventListener('dragover', (e) => {
          e.preventDefault();
          col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', (e) => {
          e.preventDefault();
          col.classList.remove('drag-over');
          if (draggingLine == null) return;
          const task = findTask(draggingLine);
          if (!task || task.status === nextStatus) return;
          const updated: FlatTask = { ...task, status: nextStatus };
          currentSource = patchSourceWithDescription(currentSource, task.line, serializeTaskLine(updated), task.description);
          emitChange();
          rerender();
        });
      });
    }

    const applyBtn = root.querySelector<HTMLElement>('.yattc-apply');
    const editInput = root.querySelector<HTMLTextAreaElement>('.yattc-edit');
    if (applyBtn && editInput) {
      applyBtn.addEventListener('click', () => {
        currentSource = editInput.value;
        emitChange();
        rerender();
      });
    }
  };

  rerender();

  return {
    getSource: () => currentSource,
    updateSource: (nextSource: string) => {
      currentSource = nextSource;
      rerender();
    },
    destroy: () => {
      root.innerHTML = '';
    },
  };
}

