import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { parse, validate, schedule, renderGanttSVG } from '../src/index.js';
import type { Task, ParallelBlock, DocumentItem } from '../src/types.js';

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
  let fenceClose = '```';
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
    // Yatt fences (backtick or tilde)
    if (/^```yatt\s*$/.test(line)) { flushProse(); fenceClose = '```'; state = 'yatt'; continue; }
    if (/^~~~yatt\s*$/.test(line)) { flushProse(); fenceClose = '~~~'; state = 'yatt'; continue; }
    // Non-yatt fences — collect as prose (keeps content but won't misparse inner yatt)
    if (/^```/.test(line)) { buf.push(line); fenceClose = '```'; state = 'fence'; continue; }
    if (/^~~~/.test(line)) { buf.push(line); fenceClose = '~~~'; state = 'fence'; continue; }
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) { flushProse(); blocks.push({ kind: 'heading', level: hm[1].length, text: hm[2] }); continue; }
    buf.push(line);
  }
  flushProse();
  return blocks;
}

// ── Task info type ─────────────────────────────────────────────────────────────

interface TaskInfo {
  name: string;
  status: string;
  description?: string;
  assignees: string[];
  tags: string[];
  priority?: string;
  progress?: number;
  start?: string;
  end?: string;
  duration?: string;
  startDate?: string;
  dueDate?: string;
  id?: string;
  after?: string;
  modifiers?: string[];
  line: number;
  depth: number;
  dotPrefix: string;
}

// ── Task extractor (reused by renderYattBlock) ────────────────────────────────

function extractTasksFromItems(items: DocumentItem[]): TaskInfo[] {
  const tasks: TaskInfo[] = [];

  function fmt(d: Date | undefined): string | undefined {
    return d ? d.toISOString().slice(0, 10) : undefined;
  }

  function walkTask(t: Task, depth: number) {
    const dotPrefix = '.'.repeat(depth);
    const info: TaskInfo = {
      name: t.name, status: t.status, assignees: t.assignees,
      tags: t.tags, depth, dotPrefix, line: t.line,
    };
    if (t.priority) info.priority = t.priority;
    if (t.progress !== undefined) info.progress = t.progress;
    if (t.id) info.id = t.id;
    if (t.duration) info.duration = `${t.duration.value}${t.duration.unit}`;
    if (t.startDate) info.startDate = t.startDate;
    if (t.dueDate) info.dueDate = t.dueDate;
    if (t.after.length) info.after = t.after.map(d => d.ids.join(d.logic === 'or' ? '|' : ',')).join(',');
    if (t.modifiers.length) info.modifiers = [...t.modifiers];
    if (t.description) info.description = t.description;
    const s = fmt(t.computedStart), e = fmt(t.computedEnd);
    if (s) info.start = s;
    if (e) info.end = e;
    tasks.push(info);
    for (const sub of t.subtasks) walkTask(sub, depth + 1);
  }

  function walk(its: DocumentItem[]) {
    for (const item of its) {
      if (item.type === 'task') walkTask(item as Task, 0);
      else if (item.type === 'parallel') walk((item as ParallelBlock).items as DocumentItem[]);
    }
  }

  walk(items);
  return tasks;
}

// ── YATT block renderer ───────────────────────────────────────────────────────

interface RenderedBlock {
  kind: 'heading' | 'yatt' | 'prose';
  level?: number;
  text?: string;
  html?: string;
  errors?: string[];
  tasks?: TaskInfo[];
  source?: string;
}

function renderYattBlock(source: string): { html: string; errors: string[]; tasks: TaskInfo[] } {
  const { doc, errors: parseErrors } = parse(source);
  const validationErrors = validate(doc);
  const scheduled = schedule(doc);
  const html = renderGanttSVG(scheduled, { theme: 'dark', width: 1100 });
  const errors = [...parseErrors, ...validationErrors].map(e => `Line ${e.line}: ${e.message}`);
  const tasks = extractTasksFromItems(doc.items);
  return { html, errors, tasks };
}

function renderFile(absPath: string): RenderedBlock[] {
  const source = fs.readFileSync(absPath, 'utf8');
  const blocks = parseMdBlocks(source);
  return blocks.map(b => {
    if (b.kind === 'yatt') {
      const { html, errors, tasks } = renderYattBlock(b.source);
      return { kind: 'yatt' as const, html, errors, tasks, source: b.source };
    }
    if (b.kind === 'heading') return { kind: 'heading' as const, level: b.level, text: b.text };
    return { kind: 'prose' as const, text: b.text };
  });
}

// ── Block source patcher ──────────────────────────────────────────────────────

function replaceYattBlock(fileSource: string, blockIdx: number, newSource: string): string {
  const lines = fileSource.split(/\r?\n/);
  let idx = 0;
  let scanState: 'normal' | 'yatt' | 'fence' = 'normal';
  let fenceClose = '```';
  let contentStart = -1;
  let contentEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (scanState === 'yatt') {
      if (ln.trimEnd() === fenceClose) {
        if (idx === blockIdx) { contentEnd = i; break; }
        idx++; scanState = 'normal';
      }
      continue;
    }
    if (scanState === 'fence') {
      if (ln.trimEnd() === fenceClose) scanState = 'normal';
      continue;
    }
    if (/^```yatt\s*$/.test(ln)) {
      if (idx === blockIdx) contentStart = i + 1;
      fenceClose = '```'; scanState = 'yatt'; continue;
    }
    if (/^~~~yatt\s*$/.test(ln)) {
      if (idx === blockIdx) contentStart = i + 1;
      fenceClose = '~~~'; scanState = 'yatt'; continue;
    }
    if (/^```/.test(ln)) { fenceClose = '```'; scanState = 'fence'; continue; }
    if (/^~~~/.test(ln)) { fenceClose = '~~~'; scanState = 'fence'; continue; }
  }

  if (contentStart < 0 || contentEnd < 0) throw new Error(`YATT block ${blockIdx} not found`);
  const newLines = newSource.split(/\r?\n/);
  lines.splice(contentStart, contentEnd - contentStart, ...newLines);
  return lines.join('\n');
}

// ── SSE manager ───────────────────────────────────────────────────────────────

class SseManager {
  private clients = new Set<http.ServerResponse>();
  add(res: http.ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
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
  const fire = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => sse.broadcast('reload'), 150); };
  try { fs.watch(rootDir, { recursive: true }, (_e, f) => { if (f && f.endsWith('.md')) fire(); }); }
  catch  { fs.watch(rootDir, {}, (_e, f) => { if (f && f.endsWith('.md')) fire(); }); }
}

// ── Browser opener ────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') execFile('explorer', [url], () => {});
    else if (process.platform === 'darwin') execFile('open', [url], () => {});
    else execFile('xdg-open', [url], () => {});
  } catch { /* ignore */ }
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
  background: var(--panel); scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
#sidebar::-webkit-scrollbar { width: 4px; }
#sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
#sidebar-inner { padding: 6px 0; }
.group-label { font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); padding: 10px 14px 3px; }
.file-item { display: block; padding: 5px 14px; font-size: 12px; color: var(--text);
  cursor: pointer; text-decoration: none; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; border-left: 2px solid transparent; transition: background 0.1s; }
.file-item:hover { background: rgba(56,139,253,0.08); }
.file-item.active { background: rgba(56,139,253,0.14); color: var(--accent-hi); border-left-color: var(--accent); }

/* ── main ── */
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.view-panel { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.view-panel::-webkit-scrollbar { width: 6px; }
.view-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* ── document view ── */
#doc-content { max-width: 1200px; margin: 0 auto; padding: 28px 36px 80px; }
.block-h1 { font-size: 24px; font-weight: 700; margin: 32px 0 12px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.block-h2 { font-size: 18px; font-weight: 600; margin: 24px 0 8px; }
.block-h3, .block-h4, .block-h5, .block-h6 { font-size: 14px; font-weight: 600; margin: 18px 0 6px; color: var(--muted); }
.prose { line-height: 1.65; color: var(--text); margin: 12px 0; }
.prose p { margin: 6px 0; }
.prose ul, .prose ol { padding-left: 20px; margin: 6px 0; }
.prose li { margin: 3px 0; }
.prose strong { font-weight: 600; }
.prose em { font-style: italic; }
.prose a { color: var(--accent-hi); }
.prose h1,.prose h2,.prose h3,.prose h4 { font-weight: 600; margin: 14px 0 6px; }
.prose blockquote { border-left: 2px solid var(--border); padding-left: 12px; color: var(--muted); margin: 8px 0; }
.prose hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.prose code { font-family: ui-monospace, monospace; font-size: 12px;
  background: var(--panel2); padding: 1px 5px; border-radius: 3px; color: var(--accent-hi); }
.prose pre { background: var(--panel2); border: 1px solid var(--border); border-radius: 6px;
  padding: 14px 16px; overflow-x: auto; margin: 10px 0; }
.prose pre code { background: none; padding: 0; font-size: 12px; color: var(--text); }
.prose table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
.prose th { text-align: left; padding: 6px 12px; background: var(--panel2);
  border: 1px solid var(--border); font-weight: 600; }
.prose td { padding: 6px 12px; border: 1px solid var(--border); }
.prose tr:nth-child(even) td { background: rgba(255,255,255,0.02); }

/* ── yatt control (embedded per-block) ── */
.yatt-ctrl { margin: 16px 0; border: 1px solid var(--border); border-radius: 8px; overflow: auto;
  display: flex; flex-direction: column; resize: vertical; min-height: 400px; }
.yatt-ctrl-bar { display: flex; gap: 2px; padding: 4px 8px; flex: 0 0 auto;
  border-bottom: 1px solid var(--border); background: var(--panel2); }
.yatt-ctrl-tab { background: none; border: none; cursor: pointer; padding: 3px 10px;
  font-size: 11px; color: var(--muted); border-radius: 3px;
  transition: color 0.1s, background 0.1s; font-family: inherit; }
.yatt-ctrl-tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
.yatt-ctrl-tab.active { color: var(--accent-hi); background: rgba(56,139,253,0.12); }
.yatt-ctrl-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.yatt-ctrl-panel { display: none; }
.yatt-ctrl-panel.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
.yatt-ctrl-panel[data-panel="timeline"] svg { max-width: 100%; height: auto; display: block; }
.yatt-errors { background: rgba(248,81,73,0.08); border-bottom: 1px solid rgba(248,81,73,0.25);
  padding: 6px 12px; font-size: 11px; color: var(--red); font-family: ui-monospace, monospace; }

/* ── kanban (inside control and shared atoms) ── */
.ctrl-kanban { display: flex; gap: 10px; padding: 12px; overflow-x: auto; align-items: flex-start; }
.k-col { flex: 0 0 200px; background: var(--bg); border-radius: 6px;
  border: 1px solid var(--border); display: flex; flex-direction: column; max-height: 360px; }
.k-col-header { padding: 8px 12px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.k-col-line { width: 3px; height: 12px; border-radius: 2px; flex-shrink: 0; }
.k-col-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; flex: 1; }
.k-col-count { font-size: 11px; color: var(--muted); }
.k-cards { overflow-y: auto; padding: 6px; display: flex; flex-direction: column;
  gap: 5px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.k-cards::-webkit-scrollbar { width: 3px; }
.k-cards::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.k-card { background: var(--panel); border: 1px solid var(--border); border-radius: 5px;
  padding: 8px 10px; transition: border-color 0.12s; }
.k-card:hover { border-color: var(--accent); }
.k-card-name { font-size: 11px; color: var(--text); line-height: 1.4; margin-bottom: 3px; }
.k-card-desc { font-size: 10px; color: var(--muted); line-height: 1.4; margin-bottom: 5px; font-style: italic; }
.k-shift-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600;
  border-radius: 3px; padding: 1px 5px; margin-right: 3px; }
.k-shift-badge.delayed { background: rgba(245,158,11,0.15); color: #f59e0b; }
.k-shift-badge.blocked { background: rgba(239,68,68,0.15); color: #ef4444; }
.k-card-shifts { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 5px; }
.k-card-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.k-progress { height: 2px; background: var(--border); border-radius: 1px; margin-top: 6px; overflow: hidden; }
.k-progress-fill { height: 100%; border-radius: 1px; background: var(--accent); }
.k-priority { font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,0.06); color: var(--muted); }
.k-priority[data-p="critical"] { color: var(--red); }
.k-priority[data-p="high"] { color: var(--orange); }

/* ── people (inside control) ── */
.ctrl-people { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.person-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.person-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid var(--border); }
.person-name { font-size: 12px; font-weight: 600; }
.person-count { font-size: 11px; color: var(--muted); margin-top: 1px; }
.ptask-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-bottom: 1px solid var(--border); }
.ptask-row:last-child { border-bottom: none; }
.ptask-name { font-size: 12px; flex: 1; }
.ptask-priority { font-size: 10px; color: var(--muted); }
.ptask-priority[data-p="critical"] { color: var(--red); }
.ptask-priority[data-p="high"] { color: var(--orange); }
.ptask-prog { font-size: 10px; color: var(--muted); font-family: ui-monospace, monospace; }

/* ── markdown/edit view ── */
#view-markdown { display: flex; flex-direction: column; overflow: hidden; }
#view-markdown.view-panel { overflow: hidden; }
.view-panel[hidden] { display: none !important; }
#editor { display: block; flex: 1 1 0; min-height: 0; width: 100%; resize: none;
  background: var(--bg); color: var(--text); border: none; outline: none;
  padding: 24px 32px; font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px; line-height: 1.65; tab-size: 2; }

/* ── yatt source panel (read-only) ── */
.yatt-src { padding: 16px; font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.6; overflow-x: auto;
  background: var(--bg); color: var(--text); white-space: pre; margin: 0; }

/* ── yatt inline block editor ── */
.yatt-block-editor { display: block; width: 100%; flex: 1; min-height: 0; padding: 14px 16px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px; line-height: 1.6; background: var(--bg); color: var(--text);
  border: none; outline: none; resize: none; tab-size: 2; }
.yatt-block-bar { display: flex; align-items: center; padding: 4px 12px;
  border-top: 1px solid var(--border); background: var(--panel2); min-height: 26px; }
.yatt-block-status { font-size: 10px; }

/* ── task edit modal ── */
#task-edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000;
  display: flex; align-items: center; justify-content: center; }
#task-edit-overlay.hidden { display: none; }
#task-edit-modal { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 22px 24px; width: 500px; max-height: 88vh; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.te-title { font-size: 15px; font-weight: 700; margin-bottom: 16px; color: var(--text); }
.te-row { display: grid; gap: 10px; margin-bottom: 10px; }
.te-row.cols-2 { grid-template-columns: 1fr 1fr; }
.te-row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
.te-field label { display: block; font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
.te-field input, .te-field select { width: 100%; background: var(--bg); border: 1px solid var(--border);
  border-radius: 5px; color: var(--text); padding: 5px 8px; font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.1s; }
.te-field input:focus, .te-field select:focus { border-color: var(--accent); }
.te-field textarea { width: 100%; background: var(--bg); border: 1px solid var(--border);
  border-radius: 5px; color: var(--text); padding: 5px 8px; font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.1s; resize: vertical; min-height: 56px; box-sizing: border-box; }
.te-field textarea:focus { border-color: var(--accent); }
.te-field select option { background: var(--panel); }
.te-actions { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
.te-save-msg { font-size: 11px; color: var(--muted); flex: 1; }
.te-btn { padding: 5px 16px; border-radius: 5px; border: none; cursor: pointer;
  font-size: 12px; font-family: inherit; font-weight: 500; transition: opacity 0.1s; }
.te-btn-primary { background: var(--accent); color: #fff; }
.te-btn-primary:hover { opacity: 0.85; }
.te-btn-ghost { background: rgba(255,255,255,0.06); color: var(--text); border: 1px solid var(--border); }
.te-btn-ghost:hover { background: rgba(255,255,255,0.1); }

/* ── kanban drag ── */
.k-col.drag-over .k-cards { background: rgba(56,139,253,0.08); border-radius: 0 0 6px 6px; }
.k-card.dragging { opacity: 0.35; }
.k-card[data-line] { cursor: pointer; }
.k-card[data-line]:hover { border-color: var(--accent-hi); }
.ptask-row[data-line] { cursor: pointer; }
.ptask-row[data-line]:hover { background: rgba(56,139,253,0.06); }

/* ── gantt hover card ── */
#gantt-hover-card { display:none; position:fixed; z-index:9999; pointer-events:none;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; min-width: 180px; max-width: 260px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25); font-size: 12px; }
.ghc-name { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; line-height: 1.3; }
.ghc-row { display: flex; align-items: center; gap: 6px; color: var(--muted); margin-bottom: 3px; font-size: 11px; }
.ghc-status { display: inline-flex; align-items: center; gap: 4px; }
.ghc-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ghc-desc { color: var(--muted); font-style: italic; font-size: 11px; margin-top: 6px;
  padding-top: 6px; border-top: 1px solid var(--border); line-height: 1.4; }
.ghc-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 5px; }
.ghc-tag { background: var(--border); color: var(--muted); border-radius: 3px; padding: 1px 5px; font-size: 10px; }

/* ── shared atoms ── */
.sdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.avatar { display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; background: var(--border);
  font-size: 9px; font-weight: 700; color: var(--text); flex-shrink: 0; }
.avatar-lg { width: 32px; height: 32px; font-size: 11px; }
.loading { color: var(--muted); padding: 40px; text-align: center; font-size: 13px; }
.err { color: var(--red) !important; }
`;

const JS = `
var state = {
  files: [], currentFile: null, view: 'view',
  blocks: null, source: null, saveStatus: '', saveTimer: null,
  editTask: null, editCtrlId: null, editBidx: null
};

// Persists the active panel for each yatt ctrl across SSE reloads
var ctrlViews = {};

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

var STATUS_SIGIL = {
  'new':' ','active':'~','done':'x','blocked':'!',
  'at-risk':'?','deferred':'>','cancelled':'_','review':'=','paused':'o'
};

// ── Task serializer ───────────────────────────────────────────────────────
function serializeTaskLine(t) {
  var sig = STATUS_SIGIL[t.status] || ' ';
  var dp = t.dotPrefix || '';
  var head = (dp ? dp + ' ' : '') + '[' + sig + '] ' + (t.name || '');
  var fields = [];
  if (t.id) fields.push('id:' + t.id);
  if (t.duration) fields.push(t.duration);
  if (t.assignees && t.assignees.length) fields.push(t.assignees.map(function(a){return '@'+a;}).join(' '));
  if (t.tags && t.tags.length) fields.push(t.tags.map(function(a){return '#'+a;}).join(' '));
  if (t.priority && t.priority !== 'normal') fields.push('!' + t.priority);
  if (t.progress != null && t.progress !== '') fields.push('%' + t.progress);
  if (t.startDate) fields.push('>' + t.startDate);
  if (t.dueDate) fields.push('<' + t.dueDate);
  if (t.after) fields.push('after:' + t.after);
  if (t.modifiers && t.modifiers.length) t.modifiers.forEach(function(m) {
    var shiftMatch = m.match(/^(delayed|blocked):(.+)$/);
    if (shiftMatch) { fields.push(shiftMatch[1] + ' ' + shiftMatch[2]); }
    else { fields.push('+' + m); }
  });
  return head + (fields.length ? ' | ' + fields.join(' | ') : '');
}

function patchBlockSource(source, lineNum, newLine) {
  var lines = source.split('\\n');
  if (lineNum >= 1 && lineNum <= lines.length) lines[lineNum - 1] = newLine;
  return lines.join('\\n');
}

function patchBlockSourceWithDescription(source, lineNum, newLine, descText) {
  var lines = source.split('\\n');
  if (lineNum < 1 || lineNum > lines.length) return source;
  // Count existing description comment lines immediately after the task line
  var oldDescCount = 0;
  var idx = lineNum; // 0-based index of the line after the task
  while (idx < lines.length && lines[idx].trimStart().startsWith('//')) {
    oldDescCount++;
    idx++;
  }
  // Build replacement: task line + optional description comment lines
  var newLines = [newLine];
  if (descText && descText.trim()) {
    descText.trim().split('\\n').forEach(function(dl) {
      newLines.push('// ' + dl.trim());
    });
  }
  Array.prototype.splice.apply(lines, [lineNum - 1, 1 + oldDescCount].concat(newLines));
  return lines.join('\\n');
}

function saveBlock(bidx, newSource, onDone) {
  if (!state.currentFile) return;
  // Update local cache so in-flight UI doesn't see stale source
  var yblocks = (state.blocks || []).filter(function(b){ return b.kind === 'yatt'; });
  if (yblocks[bidx]) yblocks[bidx].source = newSource;
  fetch('/api/save-block?p=' + encodeURIComponent(state.currentFile) + '&idx=' + bidx, {
    method: 'POST', headers: {'Content-Type':'text/plain;charset=utf-8'}, body: newSource
  }).then(function(r) {
    if (r.ok) { if (onDone) onDone(null); }
    else r.json().then(function(d){ if (onDone) onDone(d.error || 'Error'); });
  }).catch(function(e){ if (onDone) onDone(e.message); });
}

// ── Task edit popup ───────────────────────────────────────────────────────
function openTaskEdit(task) {
  if (!task) return;
  state.editTask = task;
  document.getElementById('te-name').value = task.name || '';
  document.getElementById('te-status').value = task.status || 'new';
  document.getElementById('te-assignees').value = (task.assignees||[]).map(function(a){return '@'+a;}).join(' ');
  document.getElementById('te-tags').value = (task.tags||[]).map(function(a){return '#'+a;}).join(' ');
  document.getElementById('te-priority').value = task.priority || 'normal';
  document.getElementById('te-progress').value = task.progress != null ? task.progress : '';
  document.getElementById('te-duration').value = task.duration || '';
  document.getElementById('te-startdate').value = task.startDate || '';
  document.getElementById('te-duedate').value = task.dueDate || '';
  document.getElementById('te-id').value = task.id || '';
  document.getElementById('te-after').value = task.after || '';
  document.getElementById('te-description').value = task.description || '';
  var mods = task.modifiers || [];
  var delayedMod = mods.find(function(m){ return m.match(/^delayed:/); });
  var blockedMod = mods.find(function(m){ return m.match(/^blocked:/); });
  document.getElementById('te-delayed').value = delayedMod ? delayedMod.split(':')[1] : '';
  document.getElementById('te-blocked').value = blockedMod ? blockedMod.split(':')[1] : '';
  document.getElementById('te-save-msg').textContent = '';
  document.getElementById('task-edit-overlay').classList.remove('hidden');
  setTimeout(function(){ document.getElementById('te-name').focus(); }, 50);
}

function closeTaskEdit() {
  document.getElementById('task-edit-overlay').classList.add('hidden');
  state.editTask = null;
}

function saveTaskEdit() {
  var task = state.editTask;
  if (!task) return;
  var updated = {};
  for (var k in task) updated[k] = task[k];
  updated.name = document.getElementById('te-name').value.trim();
  updated.status = document.getElementById('te-status').value;
  var ar = document.getElementById('te-assignees').value.trim();
  updated.assignees = ar ? ar.split(/\\s+/).map(function(a){return a.replace(/^@/,'');}).filter(Boolean) : [];
  var tr = document.getElementById('te-tags').value.trim();
  updated.tags = tr ? tr.split(/\\s+/).map(function(a){return a.replace(/^#/,'');}).filter(Boolean) : [];
  updated.priority = document.getElementById('te-priority').value || 'normal';
  var pg = document.getElementById('te-progress').value;
  updated.progress = pg !== '' ? parseInt(pg, 10) : null;
  updated.duration = document.getElementById('te-duration').value.trim() || null;
  updated.startDate = document.getElementById('te-startdate').value.trim() || null;
  updated.dueDate = document.getElementById('te-duedate').value.trim() || null;
  updated.id = document.getElementById('te-id').value.trim() || null;
  updated.after = document.getElementById('te-after').value.trim() || null;
  updated.description = document.getElementById('te-description').value.trim() || null;
  // Rebuild modifiers: keep non-shift ones, then append updated delayed/blocked
  var baseMods = (updated.modifiers || []).filter(function(m){
    return !m.match(/^(delayed|blocked):/);
  });
  var delayedVal = document.getElementById('te-delayed').value.trim();
  var blockedVal = document.getElementById('te-blocked').value.trim();
  if (delayedVal) baseMods.push('delayed:' + delayedVal);
  if (blockedVal) baseMods.push('blocked:' + blockedVal);
  updated.modifiers = baseMods;

  var bidx = state.editTask.bidx;
  var yblocks = (state.blocks || []).filter(function(b){ return b.kind === 'yatt'; });
  var block = yblocks[bidx];
  if (!block || !block.source) {
    document.getElementById('te-save-msg').style.color = 'var(--red)';
    document.getElementById('te-save-msg').textContent = 'Error: block source not found';
    return;
  }
  var newLine = serializeTaskLine(updated);
  var newSource = patchBlockSourceWithDescription(block.source, task.line, newLine, updated.description);
  var msgEl = document.getElementById('te-save-msg');
  msgEl.style.color = 'var(--muted)'; msgEl.textContent = 'Saving...';
  saveBlock(bidx, newSource, function(err) {
    if (err) { msgEl.style.color='var(--red)'; msgEl.textContent='Error: '+err; }
    else { closeTaskEdit(); }
  });
}

// ── Yatt ctrl init (called after each block renders) ──────────────────────
function findTask(bidx, line) {
  var yblocks = (state.blocks || []).filter(function(b){ return b.kind === 'yatt'; });
  var block = yblocks[bidx];
  if (!block) return null;
  return (block.tasks || []).find(function(t){ return t.line === line; }) || null;
}

function initYattCtrl(ctrlId, bidx) {
  var ctrl = document.getElementById(ctrlId);
  if (!ctrl) return;
  ctrl.setAttribute('data-bidx', bidx);

  // Timeline: click + hover on task rows
  var svgEl = ctrl.querySelector('[data-panel="timeline"] svg');
  if (svgEl) {
    svgEl.addEventListener('click', function(e) {
      var el = e.target;
      while (el && el !== svgEl) {
        var dl = el.getAttribute ? el.getAttribute('data-line') : null;
        if (dl) {
          var task = findTask(bidx, parseInt(dl));
          if (task) { task.bidx = bidx; openTaskEdit(task); }
          return;
        }
        el = el.parentElement;
      }
    });
    svgEl.addEventListener('mousemove', function(e) {
      var el = e.target;
      while (el && el !== svgEl) {
        var dl = el.getAttribute ? el.getAttribute('data-line') : null;
        if (dl) {
          var task = findTask(bidx, parseInt(dl));
          if (task) { showGanttHoverCard(task, e.clientX, e.clientY); return; }
        }
        el = el.parentElement;
      }
      hideGanttHoverCard();
    });
    svgEl.addEventListener('mouseleave', hideGanttHoverCard);
  }

  // Kanban: click-to-edit + drag-drop
  var kbEl = ctrl.querySelector('[data-panel="kanban"] .ctrl-kanban');
  if (kbEl) initKanban(kbEl, bidx);

  // People: click-to-edit
  var peEl = ctrl.querySelector('[data-panel="people"]');
  if (peEl) {
    peEl.querySelectorAll('.ptask-row[data-line]').forEach(function(row) {
      row.addEventListener('click', function() {
        var task = findTask(bidx, parseInt(row.getAttribute('data-line')));
        if (task) { task.bidx = bidx; openTaskEdit(task); }
      });
    });
  }

  // Markdown tab: auto-save textarea
  var mdPanel = ctrl.querySelector('[data-panel="markdown"]');
  if (mdPanel) {
    var ta = mdPanel.querySelector('.yatt-block-editor');
    var statusEl = mdPanel.querySelector('.yatt-block-status');
    if (ta) {
      var bsTimer = null;
      ta.addEventListener('input', function() {
        if (bsTimer) clearTimeout(bsTimer);
        if (statusEl) { statusEl.style.color = 'var(--orange)'; statusEl.textContent = 'Unsaved'; }
        bsTimer = setTimeout(function() {
          bsTimer = null;
          saveBlock(bidx, ta.value, function(err) {
            if (!statusEl) return;
            statusEl.textContent = err ? 'Error: '+err : 'Saved';
            statusEl.style.color = err ? 'var(--red)' : 'var(--green)';
            if (!err) setTimeout(function(){ statusEl.textContent=''; }, 2000);
          });
        }, 1200);
      });
    }
  }
}

function initKanban(kbEl, bidx) {
  var dragging = null;
  kbEl.querySelectorAll('.k-card[data-line]').forEach(function(card) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('click', function() {
      if (card.classList.contains('dragging')) return;
      var task = findTask(bidx, parseInt(card.getAttribute('data-line')));
      if (task) { task.bidx = bidx; openTaskEdit(task); }
    });
    card.addEventListener('dragstart', function(e) {
      dragging = card; card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-line'));
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('dragging'); dragging = null;
    });
  });
  kbEl.querySelectorAll('.k-col[data-status]').forEach(function(col) {
    var newStatus = col.getAttribute('data-status');
    col.addEventListener('dragover', function(e) { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', function() { col.classList.remove('drag-over'); });
    col.addEventListener('drop', function(e) {
      e.preventDefault(); col.classList.remove('drag-over');
      var tline = parseInt(e.dataTransfer.getData('text/plain') || '0');
      var task = findTask(bidx, tline);
      if (!task || task.status === newStatus) return;
      var yblocks = (state.blocks||[]).filter(function(b){return b.kind==='yatt';});
      var block = yblocks[bidx];
      if (!block||!block.source) return;
      // Update in memory immediately
      task.status = newStatus;
      var updated = {}; for (var k in task) updated[k]=task[k];
      var newSource = patchBlockSource(block.source, task.line, serializeTaskLine(updated));
      block.source = newSource;
      // Rebuild kanban in-place so we stay on the kanban tab
      kbEl.innerHTML = buildKanbanHtml(block.tasks || [], true);
      initKanban(kbEl, bidx);
      saveBlock(bidx, newSource, null);
    });
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sdot(status) {
  var c = STATUS_COLOR[status] || '#7d8590';
  return '<span class="sdot" style="background:' + c + '" title="' + esc(status) + '"></span>';
}
function shiftBadges(task) {
  var html = '';
  var mods = task.modifiers || [];
  mods.forEach(function(m) {
    var dm = m.match(/^(delayed|blocked):(.+)$/);
    if (dm) html += '<span class="k-shift-badge ' + dm[1] + '" title="' + dm[1] + ' ' + dm[2] + '">' +
      (dm[1] === 'delayed' ? '⏱' : '🚫') + ' ' + dm[2] + '</span>';
  });
  return html;
}
function avatarEl(name, large) {
  var clean = name.replace(/[^a-zA-Z]/g,'');
  var init = (clean.slice(0,2) || name.slice(0,2)).toUpperCase();
  return '<span class="' + (large ? 'avatar avatar-lg' : 'avatar') + '" title="@' + esc(name) + '">' + esc(init) + '</span>';
}

var _ghcTask = null;
function showGanttHoverCard(task, mx, my) {
  var card = document.getElementById('gantt-hover-card');
  if (!card) return;
  if (_ghcTask === task) {
    // Just reposition
    positionGhc(card, mx, my);
    return;
  }
  _ghcTask = task;
  var STATUS_COLOR_MAP = {
    new:'#93a8c4', active:'#6a9fd8', done:'#6aab85', blocked:'#c97070',
    'at-risk':'#c9a04a', deferred:'#a892cc', cancelled:'#8a96a6',
    review:'#8e7ec4', paused:'#7a90a6'
  };
  var dotColor = STATUS_COLOR_MAP[task.status] || '#94a3b8';
  var html = '<div class="ghc-name">' + esc(task.name) + '</div>';
  html += '<div class="ghc-row ghc-status"><span class="ghc-dot" style="background:' + dotColor + '"></span>' + esc(task.status) + '</div>';
  if (task.assignees && task.assignees.length) {
    html += '<div class="ghc-row">👤 ' + task.assignees.map(function(a){ return '@'+esc(a); }).join(', ') + '</div>';
  }
  if (task.progress != null) {
    html += '<div class="ghc-row">◐ ' + task.progress + '%</div>';
  }
  if (task.startDate || task.dueDate) {
    html += '<div class="ghc-row">📅 ' + esc(task.startDate || '?') + (task.dueDate ? ' → ' + esc(task.dueDate) : '') + '</div>';
  }
  if (task.duration) {
    html += '<div class="ghc-row">⏳ ' + esc(task.duration.value + task.duration.unit) + '</div>';
  }
  var mods = (task.modifiers || []);
  var delayedM = mods.find(function(m){ return m.match(/^delayed:/); });
  var blockedM = mods.find(function(m){ return m.match(/^blocked:/); });
  if (delayedM) html += '<div class="ghc-row" style="color:#c9a04a">⏱ delayed ' + esc(delayedM.split(':')[1]) + '</div>';
  if (blockedM) html += '<div class="ghc-row" style="color:#c97070">🚫 blocked ' + esc(blockedM.split(':')[1]) + '</div>';
  if (task.tags && task.tags.length) {
    html += '<div class="ghc-tags">' + task.tags.map(function(t){ return '<span class="ghc-tag">#'+esc(t)+'</span>'; }).join('') + '</div>';
  }
  if (task.description) {
    html += '<div class="ghc-desc">' + esc(task.description) + '</div>';
  }
  card.innerHTML = html;
  card.style.display = 'block';
  positionGhc(card, mx, my);
}
function positionGhc(card, mx, my) {
  var pad = 14;
  var w = card.offsetWidth || 220;
  var h = card.offsetHeight || 120;
  var left = mx + pad;
  var top  = my - h / 2;
  if (left + w > window.innerWidth - 8) left = mx - w - pad;
  if (top < 8) top = 8;
  if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
  card.style.left = left + 'px';
  card.style.top  = top  + 'px';
}
function hideGanttHoverCard() {
  _ghcTask = null;
  var card = document.getElementById('gantt-hover-card');
  if (card) card.style.display = 'none';
}
function inlineMd(s) {
  var r = esc(s).replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  return r
    .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>')
    .replace(/__(.+?)__/g,'<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g,'<em>$1</em>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank">$1</a>');
}
function isTableRow(s) { return s.trim().startsWith('|') && s.trim().endsWith('|'); }
function isSepRow(s) { return /^\\|[-|: ]+\\|$/.test(s.trim()); }
function renderTblRow(s, tag) {
  return '<tr>' + s.trim().slice(1,-1).split('|').map(function(c) {
    return '<' + tag + '>' + inlineMd(c.trim()) + '</' + tag + '>';
  }).join('') + '</tr>';
}
function simpleMarkdown(md) {
  var lines = md.split('\\n'), out = [], inList = false, inTable = false, tblHead = false;
  var inCode = false, codeLang = '', codeBuf = [];
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    // fenced code blocks
    if (inCode) {
      if (raw.trimEnd() === '\`\`\`' || raw.trimEnd() === '~~~') {
        out.push('<pre><code' + (codeLang ? ' class="lang-' + esc(codeLang) + '"' : '') + '>' +
          codeBuf.map(function(l) { return esc(l); }).join('\\n') + '</code></pre>');
        codeBuf = []; inCode = false; codeLang = '';
      } else { codeBuf.push(raw); }
      continue;
    }
    var fence = raw.match(/^(\`\`\`|~~~)(\\w*)\\s*$/);
    if (fence) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inTable) { out.push('</tbody></table>'); inTable = false; }
      inCode = true; codeLang = fence[2] || ''; continue;
    }
    // tables
    if (isTableRow(raw)) {
      if (!inTable) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<table>'); inTable = true; tblHead = true;
      }
      if (isSepRow(raw)) { tblHead = false; out.push('<tbody>'); continue; }
      if (tblHead) out.push('<thead>' + renderTblRow(raw,'th') + '</thead>');
      else out.push(renderTblRow(raw,'td'));
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
  if (inCode) out.push('<pre><code>' + codeBuf.map(function(l){return esc(l);}).join('\\n') + '</code></pre>');
  return out.join('\\n');
}

// ── Yatt control (per-block independent widget) ────────────────────────────

// Called from onclick attributes injected into innerHTML — must be top-level
function yattCtrlSetView(ctrlId, panel) {
  ctrlViews[ctrlId] = panel;
  var ctrl = document.getElementById(ctrlId);
  if (!ctrl) return;
  ctrl.querySelectorAll('.yatt-ctrl-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-panel') === panel);
  });
  ctrl.querySelectorAll('.yatt-ctrl-panel').forEach(function(p) {
    p.classList.toggle('active', p.getAttribute('data-panel') === panel);
  });
}

function buildKanbanHtml(tasks, compact) {
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
    if (compact && !cards.length) return;
    var color = STATUS_COLOR[status] || '#7d8590';
    var label = STATUS_LABEL[status] || status;
    html += '<div class="k-col" data-status="' + esc(status) + '">';
    html += '<div class="k-col-header">';
    html += '<span class="k-col-line" style="background:' + color + '"></span>';
    html += '<span class="k-col-title">' + esc(label) + '</span>';
    html += '<span class="k-col-count">' + cards.length + '</span>';
    html += '</div><div class="k-cards">';
    cards.forEach(function(t) {
      var indent = t.depth > 0 ? 'padding-left:' + (8 + t.depth * 10) + 'px;' : '';
      var lineAttr = t.line ? ' data-line="' + t.line + '"' : '';
      html += '<div class="k-card" style="' + indent + '"' + lineAttr + '>';
      html += '<div class="k-card-name">' + esc(t.name) + '</div>';
      if (t.description) {
        html += '<div class="k-card-desc">' + esc(t.description) + '</div>';
      }
      var sb = shiftBadges(t);
      if (sb) html += '<div class="k-card-shifts">' + sb + '</div>';
      html += '<div class="k-card-meta">';
      if (t.assignees && t.assignees.length) {
        t.assignees.slice(0,3).forEach(function(a) { html += avatarEl(a, false); });
      }
      if (t.priority && t.priority !== 'normal') {
        html += '<span class="k-priority" data-p="' + esc(t.priority) + '">' + esc(t.priority) + '</span>';
      }
      html += '</div>';
      if (t.progress != null) {
        html += '<div class="k-progress"><div class="k-progress-fill" style="width:' + t.progress + '%"></div></div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
  });
  if (!html) html = '<div class="loading" style="padding:20px">No tasks.</div>';
  return html;
}

function buildPeopleHtml(tasks) {
  var byPerson = {};
  (tasks || []).forEach(function(t) {
    var people = t.assignees && t.assignees.length ? t.assignees : ['(unassigned)'];
    people.forEach(function(p) {
      if (!byPerson[p]) byPerson[p] = [];
      byPerson[p].push(t);
    });
  });
  var names = Object.keys(byPerson).sort(function(a,b) {
    if (a==='(unassigned)') return 1; if (b==='(unassigned)') return -1;
    return a.localeCompare(b);
  });
  if (!names.length) return '<div class="loading" style="padding:20px">No tasks.</div>';
  var html = '';
  names.forEach(function(name) {
    var list = byPerson[name];
    var isU = name === '(unassigned)';
    html += '<div class="person-card"><div class="person-header">';
    if (!isU) html += avatarEl(name, true);
    html += '<div><div class="person-name">' + esc(isU ? 'Unassigned' : '@' + name) + '</div>';
    html += '<div class="person-count">' + list.length + ' task' + (list.length===1?'':'s') + '</div></div></div>';
    list.forEach(function(t) {
      var lineAttr = t.line ? ' data-line="' + t.line + '"' : '';
      html += '<div class="ptask-row"' + lineAttr + '>' + sdot(t.status);
      html += '<span class="ptask-name">' + esc(t.name) + '</span>';
      var sb = shiftBadges(t);
      if (sb) html += sb;
      if (t.priority && t.priority !== 'normal')
        html += '<span class="ptask-priority" data-p="' + esc(t.priority) + '">' + esc(t.priority) + '</span>';
      if (t.progress != null) html += '<span class="ptask-prog">' + t.progress + '%</span>';
      html += '</div>';
    });
    html += '</div>';
  });
  return html;
}

function buildYattCtrlHtml(block, ctrlId, bidx) {
  var errHtml = block.errors && block.errors.length
    ? '<div class="yatt-errors">' + block.errors.map(esc).join('<br>') + '</div>' : '';
  var tl = '<div class="yatt-ctrl-panel active" data-panel="timeline">' + (block.html || '') + '</div>';
  var kb = '<div class="yatt-ctrl-panel" data-panel="kanban"><div class="ctrl-kanban">' +
    buildKanbanHtml(block.tasks || [], true) + '</div></div>';
  var pe = '<div class="yatt-ctrl-panel" data-panel="people"><div class="ctrl-people">' +
    buildPeopleHtml(block.tasks || []) + '</div></div>';
  var md = '<div class="yatt-ctrl-panel" data-panel="markdown">' +
    '<textarea class="yatt-block-editor" spellcheck="false">' + esc(block.source || '') + '</textarea>' +
    '<div class="yatt-block-bar"><span class="yatt-block-status"></span></div>' +
    '</div>';
  var tabs =
    '<button class="yatt-ctrl-tab active" data-panel="timeline" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'timeline\\')">Timeline</button>' +
    '<button class="yatt-ctrl-tab" data-panel="kanban" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'kanban\\')">Kanban</button>' +
    '<button class="yatt-ctrl-tab" data-panel="people" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'people\\')">People</button>' +
    '<button class="yatt-ctrl-tab" data-panel="markdown" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'markdown\\')">Edit</button>';
  return '<div class="yatt-ctrl" id="' + ctrlId + '" data-bidx="' + bidx + '">' +
    errHtml +
    '<div class="yatt-ctrl-bar">' + tabs + '</div>' +
    '<div class="yatt-ctrl-body">' + tl + kb + pe + md + '</div>' +
    '</div>';
}

// ── Document view ─────────────────────────────────────────────────────────────

function renderViewPanel() {
  var el = document.getElementById('doc-content');
  if (!el) return;
  if (state.blocks) { buildDocument(state.blocks, el); return; }
  el.innerHTML = '<div class="loading">Loading\u2026</div>';
  fetch('/api/render?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.json(); })
    .then(function(d) { state.blocks = d.blocks || []; buildDocument(state.blocks, el); })
    .catch(function(e) { el.innerHTML = '<div class="loading err">' + esc(e.message) + '</div>'; });
}

function buildDocument(blocks, container) {
  if (!blocks || !blocks.length) {
    container.innerHTML = '<div class="loading">No content.</div>'; return;
  }
  var html = '', ctrlIdx = 0, ctrlList = [];
  blocks.forEach(function(b) {
    if (b.kind === 'heading') {
      html += '<div class="block-h' + b.level + '">' + inlineMd(b.text) + '</div>';
    } else if (b.kind === 'prose') {
      html += '<div class="prose">' + simpleMarkdown(b.text) + '</div>';
    } else if (b.kind === 'yatt') {
      var bidx = ctrlIdx++;
      html += buildYattCtrlHtml(b, 'yatt-' + bidx, bidx);
      ctrlList.push(bidx);
    }
  });
  container.innerHTML = html;
  ctrlList.forEach(function(bidx) {
    var ctrlId = 'yatt-' + bidx;
    initYattCtrl(ctrlId, bidx);
    var saved = ctrlViews[ctrlId];
    if (saved && saved !== 'timeline') yattCtrlSetView(ctrlId, saved);
  });
}

// ── Markdown/edit view ────────────────────────────────────────────────────────

function renderMarkdownView() {
  var ta = document.getElementById('editor');
  if (!ta) return;
  if (state.source !== null) { ta.value = state.source; return; }
  fetch('/api/source?p=' + encodeURIComponent(state.currentFile))
    .then(function(r) { return r.text(); })
    .then(function(src) { state.source = src; ta.value = src; })
    .catch(function(e) { ta.value = '// Error: ' + e.message; });
}

function doSave() {
  if (!state.currentFile) return;
  var ta = document.getElementById('editor');
  if (!ta) return;
  var src = ta.value; state.source = src;
  setSaveStatus('unsaved', 'Saving\u2026');
  fetch('/api/save?p=' + encodeURIComponent(state.currentFile), {
    method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: src
  })
    .then(function(r) {
      if (r.ok) setSaveStatus('saved', 'Saved');
      else r.json().then(function(d) { setSaveStatus('error', d.error || ('HTTP ' + r.status)); });
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

// ── Page-level view switching ─────────────────────────────────────────────────

function setView(v) {
  if (state.saveTimer && v !== 'markdown') {
    clearTimeout(state.saveTimer); state.saveTimer = null; doSave();
  }
  state.view = v;
  var url = new URL(window.location.href);
  url.searchParams.set('v', v);
  history.replaceState(history.state, '', url.toString());
  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === v);
  });
  ['view','markdown'].forEach(function(n) {
    var el = document.getElementById('view-' + n);
    if (el) el.hidden = (n !== v);
  });
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.currentFile) return;
  if (state.view === 'view') renderViewPanel();
  else if (state.view === 'markdown') renderMarkdownView();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

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
    html += '<div class="group-label">' + esc(dir===''?'(root)':dir+'/') + '</div>';
    groups[dir].forEach(function(f) {
      var name = f.split('/').pop();
      html += '<a class="file-item' + (f===state.currentFile?' active':'') + '" data-p="' + esc(f) + '" title="' + esc(f) + '">' + esc(name) + '</a>';
    });
  });
  document.getElementById('sidebar-inner').innerHTML = html;
  var fc = document.getElementById('file-count');
  if (fc) fc.textContent = files.length + ' file' + (files.length===1?'':'s');
  document.querySelectorAll('.file-item').forEach(function(el) {
    el.addEventListener('click', function() { navigateTo(el.getAttribute('data-p')); });
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function loadFile(p) {
  state.currentFile = p; state.blocks = null; state.source = null;
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
        loadFileList().then(function() {
          if (state.view === 'markdown') return;
          if (state.currentFile) { state.blocks = null; renderCurrentView(); }
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
  var initialView = params.get('v') || 'view';

  state.view = initialView;
  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === initialView);
  });
  ['view','markdown'].forEach(function(n) {
    var el = document.getElementById('view-' + n);
    if (el) el.hidden = (n !== initialView);
  });

  // Task edit overlay: close on backdrop click or Escape
  var overlay = document.getElementById('task-edit-overlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeTaskEdit();
    });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeTaskEdit();
  });

  // Popup form: submit on Enter in inputs (not textarea)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && state.editTask) {
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select') { e.preventDefault(); saveTaskEdit(); }
    }
  });

  loadFileList().then(function(files) {
    if (initial && files.includes(initial)) loadFile(initial);
    else if (files.length > 0) navigateTo(files[0]);
    else {
      var c = document.getElementById('doc-content');
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
      <button class="tab active" data-view="view">View</button>
      <button class="tab" data-view="markdown">Markdown</button>
    </div>
    <span id="save-status"></span>
    <span id="file-count" style="font-size:11px;color:var(--muted);flex-shrink:0"></span>
  </header>
  <div id="workspace">
    <nav id="sidebar"><div id="sidebar-inner"></div></nav>
    <main id="main">
      <div id="view-view" class="view-panel"><div id="doc-content"></div></div>
      <div id="view-markdown" class="view-panel" hidden><textarea id="editor" spellcheck="false"></textarea></div>
    </main>
  </div>
</div>

<div id="gantt-hover-card"></div>
<div id="task-edit-overlay" class="hidden">
  <div id="task-edit-modal">
    <div class="te-title">Edit Task</div>
    <div class="te-row">
      <div class="te-field"><label>Name</label><input type="text" id="te-name" placeholder="Task name"></div>
    </div>
    <div class="te-row cols-2">
      <div class="te-field"><label>Status</label>
        <select id="te-status">
          <option value="new">New</option>
          <option value="active">Active</option>
          <option value="review">Review</option>
          <option value="blocked">Blocked</option>
          <option value="at-risk">At Risk</option>
          <option value="paused">Paused</option>
          <option value="deferred">Deferred</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div class="te-field"><label>Priority</label>
        <select id="te-priority">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
    </div>
    <div class="te-row cols-2">
      <div class="te-field"><label>Assignees (space-separated)</label><input type="text" id="te-assignees" placeholder="@alice @bob"></div>
      <div class="te-field"><label>Tags (space-separated)</label><input type="text" id="te-tags" placeholder="#backend #api"></div>
    </div>
    <div class="te-row cols-3">
      <div class="te-field"><label>Duration</label><input type="text" id="te-duration" placeholder="5d, 2bd, 1w"></div>
      <div class="te-field"><label>Start Date</label><input type="text" id="te-startdate" placeholder="YYYY-MM-DD"></div>
      <div class="te-field"><label>Due Date</label><input type="text" id="te-duedate" placeholder="YYYY-MM-DD"></div>
    </div>
    <div class="te-row cols-3">
      <div class="te-field"><label>Progress (%)</label><input type="number" id="te-progress" min="0" max="100" placeholder="0"></div>
      <div class="te-field"><label>ID</label><input type="text" id="te-id" placeholder="task-slug"></div>
      <div class="te-field"><label>After (deps)</label><input type="text" id="te-after" placeholder="id1,id2"></div>
    </div>
    <div class="te-row cols-2">
      <div class="te-field"><label>Delayed by</label><input type="text" id="te-delayed" placeholder="e.g. 3d, 1w"></div>
      <div class="te-field"><label>Blocked for</label><input type="text" id="te-blocked" placeholder="e.g. 2w, 5d"></div>
    </div>
    <div class="te-row">
      <div class="te-field"><label>Description</label><textarea id="te-description" placeholder="Optional description (saved as // comment lines below the task)"></textarea></div>
    </div>
    <div class="te-actions">
      <span class="te-save-msg" id="te-save-msg"></span>
      <button class="te-btn te-btn-ghost" onclick="closeTaskEdit()">Cancel</button>
      <button class="te-btn te-btn-primary" onclick="saveTaskEdit()">Save</button>
    </div>
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

    if (pathname === '/api/source') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      if (!absPath) { res.writeHead(400); res.end('Bad request'); return; }
      try {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(fs.readFileSync(absPath, 'utf8'));
      } catch (e: any) {
        res.writeHead(500); res.end(e.message);
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
          fs.writeFileSync(absPath, Buffer.concat(chunks).toString('utf8'), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('"ok"');
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

    if (pathname === '/api/save-block' && req.method === 'POST') {
      const absPath = guardPath(rootDir, parsed.searchParams.get('p'));
      const blockIdx = parseInt(parsed.searchParams.get('idx') ?? '-1', 10);
      if (!absPath || blockIdx < 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const newBlockSource = Buffer.concat(chunks).toString('utf8');
          const fileSource = fs.readFileSync(absPath, 'utf8');
          const updated = replaceYattBlock(fileSource, blockIdx, newBlockSource);
          fs.writeFileSync(absPath, updated, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('"ok"');
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

    if (pathname === '/events') { sse.add(res); return; }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

// ── Port helpers ──────────────────────────────────────────────────────────────

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = http.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  return start; // fallback — will fail loudly at listen
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { folder, port: preferredPort } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(folder)) {
  process.stderr.write(`Error: folder not found: ${folder}\n`);
  process.exit(1);
}

(async () => {
  const port = await findFreePort(preferredPort);
  const addr = `http://localhost:${port}`;

  if (port !== preferredPort) {
    process.stdout.write(`Port ${preferredPort} in use, using ${port} instead.\n`);
  }

  const sse = new SseManager();
  watchFolder(folder, sse);
  const server = createServer(folder, port, sse);

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`\nYATT Viewer\n`);
    process.stdout.write(`  Folder : ${folder}\n`);
    process.stdout.write(`\n  Open: ${addr}\n\n`);
    process.stdout.write(`Press Ctrl+C to stop.\n\n`);
    openBrowser(addr);
  });

  server.on('error', (err: any) => {
    process.stderr.write(`Server error: ${err.message}\n`);
    process.exit(1);
  });
})();
