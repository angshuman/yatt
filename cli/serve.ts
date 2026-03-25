import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { parse, validate, schedule, renderGanttSVG } from '../src/index.js';

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
  let buf: string[] = [];

  function flushProse() {
    const t = buf.join('\n').trim();
    if (t) blocks.push({ kind: 'prose', text: t });
    buf = [];
  }

  for (const line of lines) {
    if (state === 'yatt') {
      if (line.trimEnd() === '```') {
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
      if (line.trimEnd() === '```') state = 'normal';
      continue;
    }

    // state === 'normal'
    if (/^```yatt\s*$/.test(line)) {
      flushProse();
      state = 'yatt';
      continue;
    }

    if (/^```/.test(line)) {
      buf.push(line);
      state = 'fence';
      continue;
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

// ── YATT renderer (server-side, dark theme) ───────────────────────────────────

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

// ── HTML shell ────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:       #0f172a;
  --panel:    #1e293b;
  --border:   #334155;
  --text:     #e2e8f0;
  --muted:    #94a3b8;
  --accent:   #3b82f6;
  --accent-hi:#60a5fa;
  --red:      #ef4444;
  --sidebar-w:260px;
  --topbar-h: 48px;
}
html, body { height: 100%; background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px; overflow: hidden; }

#app { display: flex; flex-direction: column; height: 100vh; }

/* topbar */
#topbar { flex: 0 0 var(--topbar-h); display: flex; align-items: center; gap: 12px;
  padding: 0 16px; background: var(--panel); border-bottom: 1px solid var(--border);
  z-index: 10; }
.logo { font-size: 15px; font-weight: 700; letter-spacing: 0.1em; color: var(--accent-hi); }
#folder-path { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; flex: 1; }
#file-count { font-size: 12px; color: var(--muted); flex-shrink: 0; }

/* workspace */
#workspace { flex: 1; display: flex; min-height: 0; }

/* sidebar */
#sidebar { flex: 0 0 var(--sidebar-w); overflow-y: auto; border-right: 1px solid var(--border);
  background: var(--panel); display: flex; flex-direction: column; }
#sidebar-inner { padding: 8px 0; }
.group-label { font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); padding: 10px 16px 4px; }
.file-item { display: block; padding: 6px 16px; font-size: 13px; color: var(--text);
  cursor: pointer; text-decoration: none; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; border-left: 3px solid transparent;
  transition: background 0.1s, color 0.1s; }
.file-item:hover { background: rgba(59,130,246,0.08); color: var(--accent-hi); }
.file-item.active { background: rgba(59,130,246,0.15); color: var(--accent-hi);
  border-left-color: var(--accent); }

/* main */
#main { flex: 1; overflow-y: auto; scrollbar-width: thin;
  scrollbar-color: var(--border) transparent; }
#main::-webkit-scrollbar { width: 6px; }
#main::-webkit-scrollbar-track { background: transparent; }
#main::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
#content { max-width: 1200px; margin: 0 auto; padding: 32px 40px 80px; }

/* empty state */
#empty { display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--muted); gap: 8px; }
#empty .big { font-size: 48px; }
#empty p { font-size: 14px; }

/* prose */
.prose { line-height: 1.7; color: var(--text); margin: 16px 0; }
.prose h1 { font-size: 24px; font-weight: 700; color: var(--text); margin: 32px 0 12px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.prose h2 { font-size: 20px; font-weight: 600; color: var(--text); margin: 28px 0 10px; }
.prose h3 { font-size: 16px; font-weight: 600; color: var(--text); margin: 20px 0 8px; }
.prose p { margin: 8px 0; }
.prose ul, .prose ol { padding-left: 20px; margin: 8px 0; }
.prose li { margin: 4px 0; }
.prose code { background: var(--panel); border: 1px solid var(--border); border-radius: 3px;
  padding: 1px 5px; font-family: ui-monospace, monospace; font-size: 12px; }
.prose pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px 16px; overflow-x: auto; margin: 12px 0; }
.prose pre code { background: none; border: none; padding: 0; font-size: 13px; }
.prose a { color: var(--accent-hi); text-decoration: underline; }
.prose blockquote { border-left: 3px solid var(--border); padding-left: 14px; color: var(--muted);
  margin: 12px 0; }
.prose hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.prose strong { font-weight: 600; color: var(--text); }

/* headings as block items */
.block-h1 { font-size: 26px; font-weight: 700; margin: 36px 0 14px;
  padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.block-h2 { font-size: 20px; font-weight: 600; margin: 28px 0 10px; color: var(--text); }
.block-h3, .block-h4, .block-h5, .block-h6 { font-size: 16px; font-weight: 600;
  margin: 20px 0 8px; color: var(--muted); }

/* yatt blocks */
.yatt-block { margin: 16px 0; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--border); }
.yatt-block svg { max-width: 100%; height: auto; display: block; }
.yatt-errors { background: rgba(239,68,68,0.1); border-bottom: 1px solid rgba(239,68,68,0.3);
  padding: 8px 12px; font-size: 12px; color: var(--red); font-family: ui-monospace, monospace; }

/* loading */
.loading { color: var(--muted); padding: 40px; text-align: center; font-size: 13px; }

/* scrollbar sidebar */
#sidebar::-webkit-scrollbar { width: 4px; }
#sidebar::-webkit-scrollbar-track { background: transparent; }
#sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`;

// Client-side JavaScript (no backticks used — use single/double quotes throughout)
const JS = `
var allFiles = [];
var currentFile = null;

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Minimal inline markdown renderer
function inlineMd(s) {
  return esc(s)
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\`(.+?)\`/g, '<code>$1</code>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function mdToHtml(md) {
  var lines = md.split('\\n');
  var out = [];
  var inList = false;
  var inCode = false;
  var codeLines = [];
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (!inCode && /^\`\`\`/.test(raw)) {
      if (inList) { out.push('</ul>'); inList = false; }
      inCode = true; codeLines = []; continue;
    }
    if (inCode) {
      if (raw.trimEnd() === '\`\`\`') {
        inCode = false;
        out.push('<pre><code>' + esc(codeLines.join('\\n')) + '</code></pre>');
      } else { codeLines.push(raw); }
      continue;
    }
    if (raw.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      continue;
    }
    var hm = raw.match(/^(#{1,6})\\s+(.+)$/);
    if (hm) {
      if (inList) { out.push('</ul>'); inList = false; }
      var tag = 'h' + hm[1].length;
      out.push('<' + tag + '>' + inlineMd(hm[2]) + '</' + tag + '>'); continue;
    }
    if (/^(---|\\*\\*\\*|___)\\s*$/.test(raw)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<hr>'); continue;
    }
    var bq = raw.match(/^>\\s?(.*)$/);
    if (bq) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<blockquote><p>' + inlineMd(bq[1]) + '</p></blockquote>'); continue;
    }
    var li = raw.match(/^[-*+]\\s+(.+)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inlineMd(li[1]) + '</li>'); continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    out.push('<p>' + inlineMd(raw) + '</p>');
  }
  if (inList) out.push('</ul>');
  return out.join('\\n');
}

// Build sidebar
function buildSidebar(files) {
  allFiles = files;
  var groups = {};
  files.forEach(function(f) {
    var parts = f.split('/');
    var dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  });
  var keys = Object.keys(groups).sort(function(a, b) {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
  var html = '';
  keys.forEach(function(dir) {
    var label = dir === '' ? '(root)' : dir + '/';
    html += '<div class="group-label">' + esc(label) + '</div>';
    groups[dir].forEach(function(f) {
      var name = f.split('/').pop();
      var active = f === currentFile ? ' active' : '';
      html += '<a class="file-item' + active + '" data-p="' + esc(f) + '" title="' + esc(f) + '">' + esc(name) + '</a>';
    });
  });
  document.getElementById('sidebar-inner').innerHTML = html;
  document.getElementById('file-count').textContent = files.length + ' file' + (files.length === 1 ? '' : 's');
  document.querySelectorAll('.file-item').forEach(function(el) {
    el.addEventListener('click', function() { navigateTo(el.getAttribute('data-p')); });
  });
}

// Render blocks into #content
function renderBlocks(blocks) {
  var content = document.getElementById('content');
  if (!blocks || blocks.length === 0) {
    content.innerHTML = '<div class="loading">No YATT blocks or content found.</div>';
    return;
  }
  var html = '';
  blocks.forEach(function(b) {
    if (b.kind === 'heading') {
      var cls = 'block-h' + b.level;
      html += '<div class="' + cls + '">' + inlineMd(b.text) + '</div>';
    } else if (b.kind === 'yatt') {
      var errs = '';
      if (b.errors && b.errors.length) {
        errs = '<div class="yatt-errors">' + b.errors.map(esc).join('<br>') + '</div>';
      }
      html += '<div class="yatt-block">' + errs + (b.html || '') + '</div>';
    } else if (b.kind === 'prose') {
      html += '<div class="prose">' + mdToHtml(b.text) + '</div>';
    }
  });
  content.innerHTML = html;
}

// Load a file
function loadFile(p) {
  currentFile = p;
  // Update active state in sidebar
  document.querySelectorAll('.file-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-p') === p);
  });
  var content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading...</div>';
  fetch('/api/render?p=' + encodeURIComponent(p))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        content.innerHTML = '<div class="loading" style="color:var(--red)">' + esc(data.error) + '</div>';
      } else {
        renderBlocks(data.blocks);
      }
    })
    .catch(function(e) {
      content.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + esc(e.message) + '</div>';
    });
}

// Load file list
function loadFileList() {
  return fetch('/api/files')
    .then(function(r) { return r.json(); })
    .then(function(files) { buildSidebar(files); return files; });
}

// Navigate
function navigateTo(p) {
  var u = new URL(window.location.href);
  u.searchParams.set('p', p);
  history.pushState({ p: p }, '', u.toString());
  loadFile(p);
}

// SSE live reload
function connectSse() {
  var es = new EventSource('/events');
  var debounce = null;
  es.onmessage = function(e) {
    if (e.data === 'reload') {
      clearTimeout(debounce);
      debounce = setTimeout(function() {
        loadFileList().then(function(files) {
          if (currentFile) loadFile(currentFile);
          else if (files.length > 0) navigateTo(files[0]);
        });
      }, 200);
    }
  };
  es.onerror = function() {
    es.close();
    setTimeout(connectSse, 2000);
  };
}

// Init
window.addEventListener('DOMContentLoaded', function() {
  var folderEl = document.getElementById('folder-path');
  if (folderEl && typeof ROOT_FOLDER !== 'undefined') folderEl.textContent = ROOT_FOLDER;

  var params = new URLSearchParams(window.location.search);
  var initial = params.get('p');

  loadFileList().then(function(files) {
    if (initial && files.includes(initial)) {
      loadFile(initial);
    } else if (files.length > 0) {
      navigateTo(files[0]);
    } else {
      document.getElementById('content').innerHTML =
        '<div id="empty"><div class="big">📋</div><p>No .md files found in this folder.</p></div>';
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
    <span id="file-count"></span>
  </header>
  <div id="workspace">
    <nav id="sidebar"><div id="sidebar-inner"></div></nav>
    <main id="main"><div id="content"></div></main>
  </div>
</div>
<script>var ROOT_FOLDER = ${JSON.stringify(rootDir)};\n${JS}</script>
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
      const relPath = parsed.searchParams.get('p');
      if (!relPath) { res.writeHead(400); res.end('"Missing p"'); return; }
      const absPath = path.resolve(rootDir, relPath);
      // Path traversal guard
      const safeRoot = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
      if (!absPath.startsWith(safeRoot) && absPath !== rootDir) {
        res.writeHead(403); res.end('"Forbidden"'); return;
      }
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
