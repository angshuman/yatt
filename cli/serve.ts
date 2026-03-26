import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { parse, validate, schedule, renderGanttSVG } from '../src/index.js';
import type { Task, Milestone, ParallelBlock, DocumentItem } from '../src/types.js';

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { folder: string; port: number } {
  let folder = process.cwd();
  let port = 3000;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      port = parseInt(argv[++i], 10);
    } else if (!argv[i].startsWith('-')) {
      folder = path.resolve(argv[i]);
    }
  }
  return { folder, port };
}

// ── File walker ───────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', '.next', '.nuxt']);

function walkMdFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
    }
  }
  walk(rootDir);
  return results.sort();
}

// ── Markdown block parser ─────────────────────────────────────────────────────

type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'yatt'; source: string }
  | { kind: 'prose'; text: string };

function parseMdBlocks(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.split(/\r?\n/);
  let state: 'normal' | 'yatt' | 'fence' = 'normal';
  let fenceClose = '```';   // tracks whether we opened with ``` or ~~~
  let buf: string[] = [];

  function flushProse() {
    const t = buf.join('\n').trim();
    if (t) blocks.push({ kind: 'prose', text: t });
    buf = [];
  }

  for (const line of lines) {
    if (state === 'yatt') {
      if (line.trimEnd() === fenceClose) {
        blocks.push({ kind: 'yatt', source: buf.join('\n') });
        buf = [];
        state = 'normal';
      } else {
        buf.push(line);
      }
      continue;
    }
    if (state === 'fence') {
      buf.push(line);
      if (line.trimEnd() === fenceClose) state = 'normal';
      continue;
    }
    // Opening ```yatt or ~~~yatt fence
    if (/^```yatt\s*$/.test(line)) {
      flushProse(); fenceClose = '```'; state = 'yatt'; continue;
    }
    if (/^~~~yatt\s*$/.test(line)) {
      flushProse(); fenceClose = '~~~'; state = 'yatt'; continue;
    }
    // Opening ``` fence (non-yatt)
    if (/^```/.test(line)) {
      buf.push(line); fenceClose = '```'; state = 'fence'; continue;
    }
    // Opening ~~~ fence (tilde-style — non-yatt)
    if (/^~~~/.test(line)) {
      buf.push(line); fenceClose = '~~~'; state = 'fence'; continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      flushProse();
      blocks.push({ kind: 'heading', level: hm[1].length, text: hm[2] });
      continue;
    }
    buf.push(line);
  }
  flushProse();
  return blocks;
}

// ── YATT renderers ────────────────────────────────────────────────────────────

interface RenderedBlock {
  kind: 'heading' | 'yatt' | 'prose';
  level?: number;
  text?: string;
  html?: string;
  errors?: string[];
}

function renderYattBlock(source: string): { html: string; errors: string[] } {
  const { doc, errors: parseErrors } = parse(source);
  const validationErrors = validate(doc);
  const scheduled = schedule(doc);
  const html = renderGanttSVG(scheduled, { theme: 'dark', width: 1100 });
  const errors = [...parseErrors, ...validationErrors].map(e => `Line ${e.line}: ${e.message}`);
  return { html, errors };
}

function renderFile(absPath: string): RenderedBlock[] {
  const source = fs.readFileSync(absPath, 'utf8');
  const blocks = parseMdBlocks(source);
  return blocks.map(b => {
    if (b.kind === 'yatt') {
      const { html, errors } = renderYattBlock(b.source);
      return { kind: 'yatt' as const, html, errors };
    }
    if (b.kind === 'heading') return { kind: 'heading' as const, level: b.level, text: b.text };
    return { kind: 'prose' as const, text: b.text };
  });
}

// ── Task data serializer (for Kanban / People views) ──────────────────────────

interface TaskInfo {
  name: string;
  status: string;
  assignees: string[];
  priority?: string;
  progress?: number;
  start?: string;
  end?: string;
  depth: number;
}

function serializeFileData(absPath: string): { tasks: TaskInfo[] } {
  const source = fs.readFileSync(absPath, 'utf8');
  const blocks = parseMdBlocks(source);
  const tasks: TaskInfo[] = [];

  function fmtDate(d: Date | undefined): string | undefined {
    return d ? d.toISOString().slice(0, 10) : undefined;
  }

  function walkTask(t: Task, depth: number) {
    const info: TaskInfo = {
      name: t.name,
      status: t.status,
      assignees: t.assignees,
      depth,
    };
    if (t.priority) info.priority = t.priority;
    if (t.progress !== undefined) info.progress = t.progress;
    const s = fmtDate(t.computedStart);
    const e = fmtDate(t.computedEnd);
    if (s) info.start = s;
    if (e) info.end = e;
    tasks.push(info);
    for (const sub of t.subtasks) walkTask(sub, depth + 1);
  }

  function walkItems(items: DocumentItem[]) {
    for (const item of items) {
      if (item.type === 'task') walkTask(item as Task, 0);
      else if (item.type === 'parallel') walkItems((item as ParallelBlock).items as DocumentItem[]);
    }
  }

  for (const block of blocks) {
    if (block.kind !== 'yatt') continue;
    try {
      const { doc } = parse(block.source);
      schedule(doc);
      walkItems(doc.items);
    } catch { /* skip malformed blocks */ }
  }

  return { tasks };
}

// ── SSE manager ───────────────────────────────────────────────────────────────

class SseManager {
  private clients = new Set<http.ServerResponse>();

  add(res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':ok\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(event: string) {
    const msg = `data: ${event}\n\n`;
    for (const res of this.clients) res.write(msg);
  }
}

// ── File watcher ──────────────────────────────────────────────────────────────

function watchFolder(rootDir: string, sse: SseManager): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => sse.broadcast('reload'), 150);
  };
  try {
    fs.watch(rootDir, { recursive: true }, (_evt, filename) => {
      if (filename && filename.endsWith('.md')) fire();
    });
  } catch {
    fs.watch(rootDir, {}, (_evt, filename) => {
      if (filename && filename.endsWith('.md')) fire();
    });
  }
}

// ── Browser opener ────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmds: Record<string, [string, string[]]> = {
    win32:  ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux:  ['xdg-open', [url]],
  };
  const [cmd, args] = cmds[process.platform] ?? cmds['linux'];
  execFile(cmd, args, () => {});
}

// ── Path guard ────────────────────────────────────────────────────────────────

function guardPath(rootDir: string, relPath: string | null): string | null {
  if (!relPath) return null;
  const absPath = path.resolve(rootDir, relPath);
  const safeRoot = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (!absPath.startsWith(safeRoot) && absPath !== rootDir) return null;
  return absPath;
}

// ── HTML shell ────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:        #0d1117;
  --panel:     #161b22;
  --panel2:    #1c2128;
  --border:    #30363d;
  --text:      #e6edf3;
  --muted:     #7d8590;
  --accent:    #388bfd;
  --accent-hi: #79c0ff;
  --green:     #3fb950;
  --red:       #f85149;
  --orange:    #f0883e;
  --yellow:    #d29922;
  --purple:    #bc8cff;
  --sidebar-w: 240px;
  --topbar-h:  46px;
}
html, body { height: 100%; background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px; overflow: hidden; }

#app { display: flex; flex-direction: column; height: 100vh; }

/* ── topbar ── */
#topbar { flex: 0 0 var(--topbar-h); display: flex; align-items: center; gap: 10px;
  padding: 0 14px; background: var(--panel); border-bottom: 1px solid var(--border); z-index: 10; }
.logo { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent-hi);
  text-transform: uppercase; flex-shrink: 0; }
#folder-path { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; flex: 1; min-width: 0; }
#view-tabs { display: flex; gap: 2px; flex-shrink: 0; }
.tab { background: none; border: none; cursor: pointer; padding: 5px 12px;
  font-size: 12px; color: var(--muted); border-radius: 4px;
  transition: color 0.1s, background 0.1s; font-family: inherit; }
.tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
.tab.active { color: var(--accent-hi); background: rgba(56,139,253,0.12); }
#save-status { font-size: 11px; color: var(--muted); flex-shrink: 0; min-width: 60px; text-align: right; }
#save-status.unsaved { color: var(--orange); }
#save-status.saved { color: var(--green); }
#save-status.error { color: var(--red); }

/* ── workspace ── */
#workspace { flex: 1; display: flex; min-height: 0; }

/* ── sidebar ── */
#sidebar { flex: 0 0 var(--sidebar-w); overflow-y: auto; border-right: 1px solid var(--border);
  background: var(--panel); display: flex; flex-direction: column; scrollbar-width: thin;
  scrollbar-color: var(--border) transparent; }
#sidebar::-webkit-scrollbar { width: 4px; }
#sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
#sidebar-inner { padding: 6px 0; }
.group-label { font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); padding: 10px 14px 3px; }
.file-item { display: block; padding: 5px 14px; font-size: 12px; color: var(--text);
  cursor: pointer; text-decoration: none; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; border-left: 2px solid transparent; transition: background 0.1s; }
.file-item:hover { background: rgba(56,139,253,0.08); }
.file-item.active { background: rgba(56,139,253,0.14); color: var(--accent-hi);
  border-left-color: var(--accent); }

/* ── main ── */
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.view-panel { flex: 1; overflow-y: auto; scrollbar-width: thin;
  scrollbar-color: var(--border) transparent; }
.view-panel::-webkit-scrollbar { width: 6px; }
.view-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* ── timeline view ── */
#tl-content { max-width: 1200px; margin: 0 auto; padding: 28px 36px 80px; }
.block-h1 { font-size: 24px; font-weight: 700; margin: 32px 0 12px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.block-h2 { font-size: 18px; font-weight: 600; margin: 24px 0 8px; }
.block-h3, .block-h4, .block-h5, .block-h6 { font-size: 14px; font-weight: 600;
  margin: 18px 0 6px; color: var(--muted); }
.yatt-block { margin: 14px 0; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--border); }
.yatt-block svg { max-width: 100%; height: auto; display: block; }
.yatt-errors { background: rgba(248,81,73,0.08); border-bottom: 1px solid rgba(248,81,73,0.25);
  padding: 6px 12px; font-size: 11px; color: var(--red); font-family: ui-monospace, monospace; }
.prose { line-height: 1.65; color: var(--text); margin: 12px 0; }
.prose p { margin: 6px 0; }
.prose ul, .prose ol { padding-left: 20px; margin: 6px 0; }
.prose li { margin: 3px 0; }
.prose strong { font-weight: 600; }
.prose em { font-style: italic; }
.prose a { color: var(--accent-hi); }
.prose h1,.prose h2,.prose h3,.prose h4 { font-weight: 600; margin: 14px 0 6px; }
.prose blockquote { border-left: 2px solid var(--border); padding-left: 12px;
  color: var(--muted); margin: 8px 0; }

/* ── kanban view ── */
#view-kanban { overflow-x: auto; overflow-y: hidden; }
#kanban-board { display: flex; gap: 10px; padding: 18px; align-items: flex-start;
  min-height: calc(100vh - var(--topbar-h)); }
.k-col { flex: 0 0 220px; background: var(--panel); border-radius: 6px;
  border: 1px solid var(--border); display: flex; flex-direction: column;
  max-height: calc(100vh - var(--topbar-h) - 36px); }
.k-col-header { padding: 9px 12px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.k-col-line { width: 3px; height: 14px; border-radius: 2px; flex-shrink: 0; }
.k-col-title { font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.07em; flex: 1; }
.k-col-count { font-size: 11px; color: var(--muted); }
.k-cards { overflow-y: auto; padding: 8px; display: flex; flex-direction: column;
  gap: 5px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.k-cards::-webkit-scrollbar { width: 3px; }
.k-cards::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.k-card { background: var(--bg); border: 1px solid var(--border); border-radius: 5px;
  padding: 9px 11px; transition: border-color 0.12s; }
.k-card:hover { border-color: var(--accent); }
.k-card-name { font-size: 12px; color: var(--text); line-height: 1.4; margin-bottom: 5px; }
.k-card-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.k-progress { height: 2px; background: var(--border); border-radius: 1px; margin-top: 7px; overflow: hidden; }
.k-progress-fill { height: 100%; border-radius: 1px; background: var(--accent); transition: width 0.2s; }
.k-priority { font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,0.06); color: var(--muted); }
.k-priority[data-p="critical"] { color: var(--red); }
.k-priority[data-p="high"] { color: var(--orange); }
.k-priority[data-p="low"] { color: var(--muted); }

/* ── people view ── */
#people-grid { padding: 22px 30px; display: flex; flex-direction: column; gap: 20px;
  max-width: 900px; }
.person-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.person-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid var(--border); }
.person-name { font-size: 13px; font-weight: 600; }
.person-count { font-size: 11px; color: var(--muted); margin-top: 1px; }
.ptask-row { display: flex; align-items: center; gap: 9px; padding: 7px 16px;
  border-bottom: 1px solid var(--border); }
.ptask-row:last-child { border-bottom: none; }
.ptask-name { font-size: 12px; flex: 1; color: var(--text); }
.ptask-priority { font-size: 10px; color: var(--muted); }
.ptask-priority[data-p="critical"] { color: var(--red); }
.ptask-priority[data-p="high"] { color: var(--orange); }
.ptask-prog { font-size: 10px; color: var(--muted); font-family: ui-monospace, monospace; }

/* ── edit view ── */
#view-edit { display: flex; flex-direction: column; overflow: hidden; }
#view-edit.view-panel { overflow: hidden; }
#editor { display: block; flex: 1 1 0; min-height: 0; width: 100%; resize: none;
  background: var(--bg); color: var(--text); border: none; outline: none; padding: 24px 32px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px; line-height: 1.65; tab-size: 2; }

/* ── prose tables ── */
.prose table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
.prose th { text-align: left; padding: 6px 12px; background: var(--panel2);
  border: 1px solid var(--border); font-weight: 600; color: var(--text); }
.prose td { padding: 6px 12px; border: 1px solid var(--border); color: var(--text); }
.prose tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
.prose code { font-family: ui-monospace, monospace; font-size: 12px;
  background: var(--panel2); padding: 1px 5px; border-radius: 3px; color: var(--accent-hi); }

/* ── shared atoms ── */
.sdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.avatar { display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; background: var(--border);
  font-size: 9px; font-weight: 700; color: var(--text); flex-shrink: 0; }
.avatar-lg { width: 34px; height: 34px; font-size: 12px; font-weight: 700; }
.loading { color: var(--muted); padding: 40px; text-align: center; font-size: 13px; }
.err { color: var(--red) !important; }
`;

// Client-side JS — no template literals; backticks escaped as needed
const JS = `
var state = {
  files: [], currentFile: null, view: 'timeline',
  blocks: null, data: null, source: null,
  saveStatus: '', saveTimer: null
};

var STATUS_COLOR = {
  'new':'#7d8590','active':'#388bfd','done':'#3fb950','blocked':'#f85149',
  'at-risk':'#f0883e','deferred':'#bc8cff','cancelled':'#30363d',
  'review':'#d29922','paused':'#484f58'
};
var STATUS_LABEL = {
  'new':'New','active':'Active','done':'Done','blocked':'Blocked',
  'at-risk':'At Risk','deferred':'Deferred','cancelled':'Cancelled',
  'review':'Review','paused':'Paused'
};
var KANBAN_COLS = ['active','new','review','blocked','at-risk','paused','deferred','done','cancelled'];

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sdot(status) {
  var c = STATUS_COLOR[status] || '#7d8590';
  return '<span class="sdot" style="background:' + c + '" title="' + esc(status) + '"></span>';
}
function avatarEl(name, large) {
  var clean = name.replace(/[^a-zA-Z]/g,'');
  var initials = (clean.slice(0,2) || name.slice(0,2)).toUpperCase();
  var cls = large ? 'avatar avatar-lg' : 'avatar';
  return '<span class="' + cls + '" title="@' + esc(name) + '">' + esc(initials) + '</span>';
}
function inlineMd(s) {
  // inline code first (before other replacements that might catch backtick content)
  var coded = esc(s).replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  return coded
    .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>')
    .replace(/__(.+?)__/g,'<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g,'<em>$1</em>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank">$1</a>');
}
function isTableRow(s) { return s.trim().startsWith('|') && s.trim().endsWith('|'); }
function isSeparatorRow(s) { return /^\\|[-| :]+\\|$/.test(s.trim()); }
function renderTableRow(s, tag) {
  var cells = s.trim().slice(1,-1).split('|');
  return '<tr>' + cells.map(function(c) {
    return '<'+tag+'>'+inlineMd(c.trim())+'</'+tag+'>';
  }).join('') + '</tr>';
}
function simpleMarkdown(md) {
  var lines = md.split('\\n'), out = [], inList = false, inTable = false, tableHead = false;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    // Table detection
    if (isTableRow(raw)) {
      if (!inTable) {
        if (inList) { out.push('</ul>'); inList = false; }
        inTable = true; tableHead = true;
        out.push('<table>');
      }
      if (isSeparatorRow(raw)) { tableHead = false; out.push('<tbody>'); continue; }
      if (tableHead) out.push('<thead>' + renderTableRow(raw,'th') + '</thead>');
      else out.push(renderTableRow(raw,'td'));
      continue;
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
    if (raw.trim() === '') { if (inList) { out.push('</ul>'); inList = false; } continue; }
    var hm = raw.match(/^(#{1,6})\\s+(.+)$/);
    if (hm) { if (inList) { out.push('</ul>'); inList = false; }
      out.push('<h'+hm[1].length+'>'+inlineMd(hm[2])+'</h'+hm[1].length+'>'); continue; }
    var bq = raw.match(/^>\\s*(.*)/);
    if (bq) { if (inList) { out.push('</ul>'); inList = false; }
      out.push('<blockquote>'+inlineMd(bq[1])+'</blockquote>'); continue; }
    var li = raw.match(/^[-*+]\\s+(.+)$/);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>'+inlineMd(li[1])+'</li>'); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (raw.trim() === '---' || raw.trim() === '***') { out.push('<hr>'); continue; }
    out.push('<p>'+inlineMd(raw)+'</p>');
  }
  if (inList) out.push('</ul>');
  if (inTable) out.push('</tbody></table>');
  return out.join('\\n');
}

// ── View switching ──────────────────────────────────────────────────────────

function setView(v) {
  if (state.saveTimer && v !== 'edit') {
    clearTimeout(state.saveTimer); state.saveTimer = null; doSave();
  }
  state.view = v;
  var url = new URL(window.location.href);
  url.searchParams.set('v', v);
  history.replaceState(history.state, '', url.toString());
  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === v);
  });
  ['timeline','kanban','people','edit'].forEach(function(n) {
    var el = document.getElementById('view-' + n);
    if (el) el.hidden = (n !== v);
  });
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.currentFile) return;
  if (state.view === 'timeline') renderTimeline();
  else if (state.view === 'kanban') renderKanban();
  else if (state.view === 'people') renderPeople();
  else if (state.view === 'edit') renderEditView();
}

// ── Timeline ────────────────────────────────────────────────────────────────

function renderTimeline() {
  var el = document.getElementById('tl-content');
  if (!el) return;
  if (state.blocks) { buildTimeline(state.blocks, el); return; }
  el.innerHTML = '<div class="loading">Loading\u2026</div>';
  fetch('/api/render?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      state.blocks = d.blocks || [];
      buildTimeline(state.blocks, el);
    })
    .catch(function(e) { el.innerHTML = '<div class="loading err">'+esc(e.message)+'</div>'; });
}

function buildTimeline(blocks, container) {
  if (!blocks || !blocks.length) {
    container.innerHTML = '<div class="loading">No content.</div>'; return;
  }
  var html = '';
  blocks.forEach(function(b) {
    if (b.kind === 'heading') {
      html += '<div class="block-h'+b.level+'">'+inlineMd(b.text)+'</div>';
    } else if (b.kind === 'yatt') {
      var errs = b.errors && b.errors.length
        ? '<div class="yatt-errors">'+b.errors.map(esc).join('<br>')+'</div>' : '';
      html += '<div class="yatt-block">'+errs+(b.html||'')+'</div>';
    } else if (b.kind === 'prose') {
      html += '<div class="prose">'+simpleMarkdown(b.text)+'</div>';
    }
  });
  container.innerHTML = html;
}

// ── Kanban ──────────────────────────────────────────────────────────────────

function renderKanban() {
  var el = document.getElementById('kanban-board');
  if (!el) return;
  if (state.data) { buildKanban(state.data.tasks, el); return; }
  el.innerHTML = '<div class="loading">Loading\u2026</div>';
  fetch('/api/data?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.json(); })
    .then(function(d) { state.data = d; buildKanban(d.tasks, el); })
    .catch(function(e) { el.innerHTML = '<div class="loading err">'+esc(e.message)+'</div>'; });
}

function buildKanban(tasks, container) {
  var byStatus = {};
  KANBAN_COLS.forEach(function(s) { byStatus[s] = []; });
  (tasks || []).forEach(function(t) {
    var s = t.status || 'new';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(t);
  });
  var html = '';
  KANBAN_COLS.forEach(function(status) {
    var cards = byStatus[status] || [];
    var color = STATUS_COLOR[status] || '#7d8590';
    var label = STATUS_LABEL[status] || status;
    html += '<div class="k-col">';
    html += '<div class="k-col-header">';
    html += '<span class="k-col-line" style="background:'+color+'"></span>';
    html += '<span class="k-col-title">'+esc(label)+'</span>';
    html += '<span class="k-col-count">'+cards.length+'</span>';
    html += '</div><div class="k-cards">';
    cards.forEach(function(t) {
      var indent = t.depth > 0 ? 'padding-left:'+(8+t.depth*10)+'px;' : '';
      html += '<div class="k-card" style="'+indent+'">';
      html += '<div class="k-card-name">'+esc(t.name)+'</div>';
      html += '<div class="k-card-meta">';
      if (t.assignees && t.assignees.length) {
        t.assignees.slice(0,3).forEach(function(a) { html += avatarEl(a, false); });
      }
      if (t.priority && t.priority !== 'normal') {
        html += '<span class="k-priority" data-p="'+esc(t.priority)+'">'+esc(t.priority)+'</span>';
      }
      html += '</div>';
      if (t.progress != null) {
        html += '<div class="k-progress"><div class="k-progress-fill" style="width:'+t.progress+'%"></div></div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

// ── People ──────────────────────────────────────────────────────────────────

function renderPeople() {
  var el = document.getElementById('people-grid');
  if (!el) return;
  if (state.data) { buildPeople(state.data.tasks, el); return; }
  el.innerHTML = '<div class="loading">Loading\u2026</div>';
  fetch('/api/data?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.json(); })
    .then(function(d) { state.data = d; buildPeople(d.tasks, el); })
    .catch(function(e) { el.innerHTML = '<div class="loading err">'+esc(e.message)+'</div>'; });
}

function buildPeople(tasks, container) {
  var byPerson = {};
  (tasks || []).forEach(function(t) {
    var people = t.assignees && t.assignees.length ? t.assignees : ['(unassigned)'];
    people.forEach(function(p) {
      if (!byPerson[p]) byPerson[p] = [];
      byPerson[p].push(t);
    });
  });
  var names = Object.keys(byPerson).sort(function(a,b) {
    if (a === '(unassigned)') return 1;
    if (b === '(unassigned)') return -1;
    return a.localeCompare(b);
  });
  if (!names.length) {
    container.innerHTML = '<div class="loading">No tasks found.</div>'; return;
  }
  var html = '';
  names.forEach(function(name) {
    var list = byPerson[name];
    var isUnassigned = name === '(unassigned)';
    html += '<div class="person-card"><div class="person-header">';
    if (!isUnassigned) html += avatarEl(name, true);
    html += '<div><div class="person-name">'+esc(isUnassigned ? 'Unassigned' : '@'+name)+'</div>';
    html += '<div class="person-count">'+list.length+' task'+(list.length===1?'':'s')+'</div></div>';
    html += '</div>';
    list.forEach(function(t) {
      html += '<div class="ptask-row">'+sdot(t.status);
      html += '<span class="ptask-name">'+esc(t.name)+'</span>';
      if (t.priority && t.priority !== 'normal') {
        html += '<span class="ptask-priority" data-p="'+esc(t.priority)+'">'+esc(t.priority)+'</span>';
      }
      if (t.progress != null) html += '<span class="ptask-prog">'+t.progress+'%</span>';
      html += '</div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

// ── Edit ─────────────────────────────────────────────────────────────────────

function renderEditView() {
  var ta = document.getElementById('editor');
  if (!ta) return;
  if (state.source !== null) { ta.value = state.source; return; }
  fetch('/api/source?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.text(); })
    .then(function(src) { state.source = src; ta.value = src; })
    .catch(function(e) { ta.value = '// Error loading: ' + e.message; });
}

function doSave() {
  if (!state.currentFile) return;
  var ta = document.getElementById('editor');
  if (!ta) return;
  var src = ta.value;
  state.source = src;
  setSaveStatus('unsaved', 'Saving\u2026');
  fetch('/api/save?p=' + encodeURIComponent(state.currentFile), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: src
  })
    .then(function(r) {
      if (r.ok) setSaveStatus('saved', 'Saved');
      else r.json().then(function(d) { setSaveStatus('error', d.error || ('HTTP '+r.status)); });
    })
    .catch(function(e) { setSaveStatus('error', e.message); });
}

function setSaveStatus(cls, text) {
  var el = document.getElementById('save-status');
  if (!el) return;
  el.className = cls; el.textContent = text;
  if (cls === 'saved') setTimeout(function() {
    if (el.textContent === 'Saved') { el.textContent = ''; el.className = ''; }
  }, 2500);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function buildSidebar(files) {
  state.files = files;
  var groups = {};
  files.forEach(function(f) {
    var parts = f.split('/');
    var dir = parts.length > 1 ? parts.slice(0,-1).join('/') : '';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  });
  var keys = Object.keys(groups).sort(function(a,b) {
    if (a==='') return -1; if (b==='') return 1; return a.localeCompare(b);
  });
  var html = '';
  keys.forEach(function(dir) {
    html += '<div class="group-label">'+esc(dir===''?'(root)':dir+'/')+'</div>';
    groups[dir].forEach(function(f) {
      var name = f.split('/').pop();
      var active = f === state.currentFile ? ' active' : '';
      html += '<a class="file-item'+active+'" data-p="'+esc(f)+'" title="'+esc(f)+'">'+esc(name)+'</a>';
    });
  });
  document.getElementById('sidebar-inner').innerHTML = html;
  var fc = document.getElementById('file-count');
  if (fc) fc.textContent = files.length+' file'+(files.length===1?'':'s');
  document.querySelectorAll('.file-item').forEach(function(el) {
    el.addEventListener('click', function() { navigateTo(el.getAttribute('data-p')); });
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function loadFile(p) {
  state.currentFile = p;
  state.blocks = null;
  state.data = null;
  state.source = null;
  document.querySelectorAll('.file-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-p') === p);
  });
  renderCurrentView();
}

function loadFileList() {
  return fetch('/api/files')
    .then(function(r) { return r.json(); })
    .then(function(files) { buildSidebar(files); return files; });
}

function navigateTo(p) {
  var u = new URL(window.location.href);
  u.searchParams.set('p', p);
  history.pushState({ p: p }, '', u.toString());
  loadFile(p);
}

// ── SSE live reload ───────────────────────────────────────────────────────────

function connectSse() {
  var es = new EventSource('/events');
  var debounce = null;
  es.onmessage = function(e) {
    if (e.data === 'reload') {
      clearTimeout(debounce);
      debounce = setTimeout(function() {
        loadFileList().then(function(files) {
          if (state.view === 'edit') return;
          if (state.currentFile) {
            state.blocks = null; state.data = null;
            renderCurrentView();
          } else if (files.length > 0) {
            navigateTo(files[0]);
          }
        });
      }, 250);
    }
  };
  es.onerror = function() { es.close(); setTimeout(connectSse, 2000); };
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', function() {
  var fp = document.getElementById('folder-path');
  if (fp && typeof ROOT_FOLDER !== 'undefined') fp.textContent = ROOT_FOLDER;

  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.addEventListener('click', function() { setView(btn.getAttribute('data-view')); });
  });

  var editor = document.getElementById('editor');
  if (editor) {
    editor.addEventListener('input', function() {
      state.source = editor.value;
      if (state.saveTimer) clearTimeout(state.saveTimer);
      setSaveStatus('unsaved', 'Unsaved');
      state.saveTimer = setTimeout(function() { state.saveTimer = null; doSave(); }, 1200);
    });
  }

  var params = new URLSearchParams(window.location.search);
  var initial = params.get('p');
  var initialView = params.get('v') || 'timeline';

  // Set initial view tabs
  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === initialView);
  });
  ['timeline','kanban','people','edit'].forEach(function(n) {
    var el = document.getElementById('view-' + n);
    if (el) el.hidden = (n !== initialView);
  });
  state.view = initialView;

  loadFileList().then(function(files) {
    if (initial && files.includes(initial)) loadFile(initial);
    else if (files.length > 0) navigateTo(files[0]);
    else {
      var c = document.getElementById('tl-content');
      if (c) c.innerHTML = '<div class="loading">No .md files found.</div>';
    }
  });

  connectSse();
});

window.addEventListener('popstate', function(e) {
  if (e.state && e.state.p) loadFile(e.state.p);
});
`;

function buildShellHtml(rootDir: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YATT Viewer</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <span class="logo">YATT</span>
    <span id="folder-path"></span>
    <div id="view-tabs">
      <button class="tab active" data-view="timeline">Timeline</button>
      <button class="tab" data-view="kanban">Kanban</button>
      <button class="tab" data-view="people">People</button>
      <button class="tab" data-view="edit">Edit</button>
    </div>
    <span id="save-status"></span>
    <span id="file-count" style="font-size:11px;color:var(--muted);flex-shrink:0"></span>
  </header>
  <div id="workspace">
    <nav id="sidebar"><div id="sidebar-inner"></div></nav>
    <main id="main">
      <div id="view-timeline" class="view-panel"><div id="tl-content"></div></div>
      <div id="view-kanban" class="view-panel" hidden><div id="kanban-board"></div></div>
      <div id="view-people" class="view-panel" hidden><div id="people-grid"></div></div>
      <div id="view-edit" class="view-panel" hidden><textarea id="editor" spellcheck="false"></textarea></div>
    </main>
  </div>
</div>
<script>var ROOT_FOLDER = ${JSON.stringify(rootDir)};
${JS}</script>
</body>
</html>`;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function createServer(rootDir: string, port: number, sse: SseManager): http.Server {
  const shellHtml = buildShellHtml(rootDir);

  return http.createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', `http://localhost:${port}`);
    const pathname = parsed.pathname;

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(shellHtml);
      return;
    }

    if (pathname === '/api/files') {
      const files = walkMdFiles(rootDir)
        .map(f => path.relative(rootDir, f).split(path.sep).join('/'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
      return;
    }

    if (pathname === '/api/render') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      if (!absPath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('"Bad request"'); return; }
      try {
        const blocks = renderFile(absPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ blocks }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/data') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      if (!absPath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('"Bad request"'); return; }
      try {
        const data = serializeFileData(absPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/source') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      if (!absPath) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad request'); return; }
      try {
        const source = fs.readFileSync(absPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(source);
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(e.message);
      }
      return;
    }

    if (pathname === '/api/save' && req.method === 'POST') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      if (!absPath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('"Bad request"'); return; }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          fs.writeFileSync(absPath, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('"ok"');
          // Broadcast so other clients see the update (edit client ignores SSE)
          sse.broadcast('reload');
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      req.on('error', (e: any) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    if (pathname === '/events') {
      sse.add(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

// ── Already-running check ─────────────────────────────────────────────────────

function checkServerRunning(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'HEAD' },
      (res) => { resolve(res.statusCode === 200); res.destroy(); },
    );
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { folder, port } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(folder)) {
  process.stderr.write(`Error: folder not found: ${folder}\n`);
  process.exit(1);
}

(async () => {
  const addr = `http://localhost:${port}`;

  if (await checkServerRunning(port)) {
    process.stdout.write(`YATT already running at ${addr}\n`);
    openBrowser(addr);
    return;
  }

  const sse = new SseManager();
  watchFolder(folder, sse);
  const server = createServer(folder, port, sse);

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`\nYATT Viewer  v0.1.0\n`);
    process.stdout.write(`Serving : ${folder}\n`);
    process.stdout.write(`URL     : ${addr}\n\n`);
    openBrowser(addr);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Error: port ${port} already in use. Try --port <number>\n`);
    } else {
      process.stderr.write(`Server error: ${err.message}\n`);
    }
    process.exit(1);
  });
})();
