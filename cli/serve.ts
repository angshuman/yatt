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
  assignees: string[];
  priority?: string;
  progress?: number;
  start?: string;
  end?: string;
  depth: number;
}

// ── Task extractor (reused by renderYattBlock) ────────────────────────────────

function extractTasksFromItems(items: DocumentItem[]): TaskInfo[] {
  const tasks: TaskInfo[] = [];

  function fmt(d: Date | undefined): string | undefined {
    return d ? d.toISOString().slice(0, 10) : undefined;
  }

  function walkTask(t: Task, depth: number) {
    const info: TaskInfo = { name: t.name, status: t.status, assignees: t.assignees, depth };
    if (t.priority) info.priority = t.priority;
    if (t.progress !== undefined) info.progress = t.progress;
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
.yatt-ctrl { margin: 16px 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.yatt-ctrl-bar { display: flex; gap: 2px; padding: 4px 8px;
  border-bottom: 1px solid var(--border); background: var(--panel2); }
.yatt-ctrl-tab { background: none; border: none; cursor: pointer; padding: 3px 10px;
  font-size: 11px; color: var(--muted); border-radius: 3px;
  transition: color 0.1s, background 0.1s; font-family: inherit; }
.yatt-ctrl-tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
.yatt-ctrl-tab.active { color: var(--accent-hi); background: rgba(56,139,253,0.12); }
.yatt-ctrl-panel { display: none; }
.yatt-ctrl-panel.active { display: block; }
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
.k-card-name { font-size: 11px; color: var(--text); line-height: 1.4; margin-bottom: 5px; }
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

/* ── yatt source panel ── */
.yatt-src { padding: 16px; font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.6; overflow-x: auto;
  background: var(--bg); color: var(--text); white-space: pre; margin: 0; }

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
  blocks: null, source: null, saveStatus: '', saveTimer: null
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
  var init = (clean.slice(0,2) || name.slice(0,2)).toUpperCase();
  return '<span class="' + (large ? 'avatar avatar-lg' : 'avatar') + '" title="@' + esc(name) + '">' + esc(init) + '</span>';
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
    html += '<div class="k-col">';
    html += '<div class="k-col-header">';
    html += '<span class="k-col-line" style="background:' + color + '"></span>';
    html += '<span class="k-col-title">' + esc(label) + '</span>';
    html += '<span class="k-col-count">' + cards.length + '</span>';
    html += '</div><div class="k-cards">';
    cards.forEach(function(t) {
      var indent = t.depth > 0 ? 'padding-left:' + (8 + t.depth * 10) + 'px;' : '';
      html += '<div class="k-card" style="' + indent + '">';
      html += '<div class="k-card-name">' + esc(t.name) + '</div>';
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
      html += '<div class="ptask-row">' + sdot(t.status);
      html += '<span class="ptask-name">' + esc(t.name) + '</span>';
      if (t.priority && t.priority !== 'normal')
        html += '<span class="ptask-priority" data-p="' + esc(t.priority) + '">' + esc(t.priority) + '</span>';
      if (t.progress != null) html += '<span class="ptask-prog">' + t.progress + '%</span>';
      html += '</div>';
    });
    html += '</div>';
  });
  return html;
}

function buildYattCtrlHtml(block, ctrlId) {
  var errHtml = block.errors && block.errors.length
    ? '<div class="yatt-errors">' + block.errors.map(esc).join('<br>') + '</div>' : '';
  var tl = '<div class="yatt-ctrl-panel active" data-panel="timeline">' + (block.html || '') + '</div>';
  var kb = '<div class="yatt-ctrl-panel" data-panel="kanban"><div class="ctrl-kanban">' +
    buildKanbanHtml(block.tasks || [], true) + '</div></div>';
  var pe = '<div class="yatt-ctrl-panel" data-panel="people"><div class="ctrl-people">' +
    buildPeopleHtml(block.tasks || []) + '</div></div>';
  var md = '<div class="yatt-ctrl-panel" data-panel="markdown"><pre class="yatt-src"><code>' +
    esc(block.source || '') + '</code></pre></div>';
  var tabs =
    '<button class="yatt-ctrl-tab active" data-panel="timeline" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'timeline\\')">Timeline</button>' +
    '<button class="yatt-ctrl-tab" data-panel="kanban" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'kanban\\')">Kanban</button>' +
    '<button class="yatt-ctrl-tab" data-panel="people" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'people\\')">People</button>' +
    '<button class="yatt-ctrl-tab" data-panel="markdown" onclick="yattCtrlSetView(\\'' + ctrlId + '\\',\\'markdown\\')">Markdown</button>';
  return '<div class="yatt-ctrl" id="' + ctrlId + '">' +
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
  var html = '', ctrlIdx = 0;
  blocks.forEach(function(b) {
    if (b.kind === 'heading') {
      html += '<div class="block-h' + b.level + '">' + inlineMd(b.text) + '</div>';
    } else if (b.kind === 'yatt') {
      html += buildYattCtrlHtml(b, 'yatt-' + ctrlIdx++);
    }
    // prose blocks are intentionally skipped in view mode
  });
  if (!html) container.innerHTML = '<div class="loading">No charts in this file.</div>';
  else container.innerHTML = html;
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
