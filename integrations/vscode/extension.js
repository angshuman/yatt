"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate,
  extendMarkdownIt: () => extendMarkdownIt
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var yatt = null;
async function getYatt() {
  if (!yatt) yatt = await import("yatt");
  return yatt;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function flattenTasks(items, out, depth = 0) {
  for (const item of items) {
    if (item.type === "task") {
      out.push({
        line: item.line,
        depth,
        name: item.name,
        status: item.status,
        assignees: [...item.assignees || []],
        tags: [...item.tags || []],
        priority: item.priority,
        progress: item.progress,
        duration: item.duration ? `${item.duration.value}${item.duration.unit}` : void 0,
        startDate: item.startDate,
        dueDate: item.dueDate,
        id: item.id,
        after: (item.after || []).map((d) => d.ids.join(d.logic === "or" ? "|" : ",")).join(","),
        modifiers: [...item.modifiers || []],
        description: item.description
      });
      if (item.subtasks?.length) flattenTasks(item.subtasks, out, depth + 1);
    } else if (item.type === "parallel") {
      flattenTasks(item.items || [], out, depth);
    }
  }
}
function buildKanbanHtml(tasks) {
  const cols = ["new", "active", "review", "blocked", "paused", "done", "cancelled"];
  const labels = {
    new: "New",
    active: "Active",
    review: "Review",
    blocked: "Blocked",
    paused: "Paused",
    done: "Done",
    cancelled: "Cancelled"
  };
  const byStatus = {};
  for (const c of cols) byStatus[c] = [];
  for (const t of tasks) (byStatus[t.status] = byStatus[t.status] || []).push(t);
  return `<div class="yvk-wrap">${cols.map((status) => {
    const cards = byStatus[status] || [];
    return `<div class="yvk-col" data-status="${status}"><div class="yvk-head">${labels[status]} <span>${cards.length}</span></div><div class="yvk-cards">${cards.map((t) => `<div class="yvk-card" draggable="true" data-line="${t.line}" style="padding-left:${8 + t.depth * 10}px"><div class="yvk-name">${esc(t.name)}</div>${t.description ? `<div class="yvk-desc">${esc(t.description)}</div>` : ""}</div>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
function buildPeopleHtml(tasks) {
  const byPerson = {};
  for (const t of tasks) {
    const people = t.assignees?.length ? t.assignees : ["(unassigned)"];
    for (const p of people) (byPerson[p] = byPerson[p] || []).push(t);
  }
  const names = Object.keys(byPerson).sort((a, b) => {
    if (a === "(unassigned)") return 1;
    if (b === "(unassigned)") return -1;
    return a.localeCompare(b);
  });
  if (!names.length) return '<div class="hint">No tasks.</div>';
  return names.map((name) => {
    const list = byPerson[name];
    return `<div class="yvp-card"><div class="yvp-head">${esc(name === "(unassigned)" ? "Unassigned" : "@" + name)} <span>${list.length}</span></div>${list.map((t) => `<div class="yvp-row" data-line="${t.line}">${esc(t.name)}${t.progress != null ? ` <small>${t.progress}%</small>` : ""}</div>`).join("")}</div>`;
  }).join("");
}
async function applyFullDocumentText(doc, nextText) {
  const edit = new vscode.WorkspaceEdit();
  const lastLine = doc.lineAt(doc.lineCount - 1);
  const fullRange = new vscode.Range(0, 0, doc.lineCount - 1, lastLine.text.length);
  edit.replace(doc.uri, fullRange, nextText);
  return vscode.workspace.applyEdit(edit);
}
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("yatt.openPreview", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lib = await getYatt();
      const docUri = editor.document.uri;
      const panel = vscode.window.createWebviewPanel(
        "yattPreview",
        "YATT Preview",
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );
      const renderPanel = (source, title) => {
        const { html, errors } = lib.render(source, "gantt");
        const { doc } = lib.parse(source);
        const scheduled = lib.schedule(doc);
        const tasks = [];
        flattenTasks(scheduled.items || [], tasks);
        panel.webview.html = wrapHtml({
          title,
          source,
          timelineHtml: html,
          kanbanHtml: buildKanbanHtml(tasks),
          peopleHtml: buildPeopleHtml(tasks),
          tasks,
          errors: errors.map((e) => `Line ${e.line}: ${e.message}`)
        });
      };
      renderPanel(editor.document.getText(), editor.document.fileName);
      const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === docUri.toString() && panel.visible) {
          renderPanel(e.document.getText(), e.document.fileName);
        }
      });
      panel.onDidDispose(() => changeSub.dispose());
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type !== "saveSource" || typeof msg.source !== "string") return;
        const doc = await vscode.workspace.openTextDocument(docUri);
        const ok = await applyFullDocumentText(doc, msg.source);
        if (!ok) {
          vscode.window.showErrorMessage("YATT: failed to save changes from preview.");
          return;
        }
        renderPanel(msg.source, doc.fileName);
      });
    })
  );
}
function deactivate() {
}
async function extendMarkdownIt(md) {
  const lib = await getYatt();
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules) ?? (() => "");
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() !== "yatt") {
      return defaultFence(tokens, idx, options, env, self);
    }
    try {
      const { html, errors } = lib.render(token.content, "gantt");
      const errorHtml = errors.length ? `<div class="yatt-errors">${errors.map((e) => `<p class="yatt-error">Line ${e.line}: ${e.message}</p>`).join("")}</div>` : "";
      return `<div class="yatt-gantt">${errorHtml}${html}</div>`;
    } catch (err) {
      return `<div class="yatt-error">YATT render error: ${err}</div>`;
    }
  };
  return md;
}
function wrapHtml(model) {
  const sourceJson = JSON.stringify(model.source);
  const tasksJson = JSON.stringify(model.tasks);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(model.title)} \u2014 YATT Preview</title>
<style>
  body { margin: 0; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  .bar { display: flex; gap: 4px; padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab { background: transparent; border: 1px solid var(--vscode-panel-border); color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .tab.active { border-color: var(--vscode-focusBorder); color: var(--vscode-textLink-foreground); }
  .panel { display: none; padding: 10px; }
  .panel.active { display: block; }
  .yvk-wrap { display: flex; gap: 8px; overflow-x: auto; align-items: flex-start; }
  .yvk-col { min-width: 210px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; }
  .yvk-col.drag-over { outline: 2px dashed var(--vscode-focusBorder); }
  .yvk-head { font-size: 12px; font-weight: 700; display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .yvk-cards { min-height: 36px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .yvk-card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; cursor: pointer; }
  .yvk-card.dragging { opacity: 0.4; }
  .yvk-name { font-size: 13px; font-weight: 600; }
  .yvk-desc { font-size: 11px; opacity: .8; margin-top: 4px; }
  .yvp-card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 10px; }
  .yvp-head { font-size: 12px; font-weight: 700; display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .yvp-row { padding: 7px 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; font-size: 12px; }
  .yvp-row:last-child { border-bottom: 0; }
  textarea#source-edit { width: 100%; min-height: 260px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 6px; font: 12px ui-monospace,Consolas,monospace; padding: 8px; }
  .actions { margin-top: 8px; display: flex; justify-content: flex-end; }
  button.save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .errors { color: var(--vscode-errorForeground); font-size: 12px; padding: 0 10px 10px; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { width: min(760px, 95vw); max-height: 90vh; overflow: auto; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid input, .grid select, .grid textarea { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 6px; font-size: 12px; }
  .grid textarea { min-height: 72px; grid-column: 1 / -1; }
  .modal-actions { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }
</style>
</head>
<body>
  <div class="bar">
    <button class="tab active" data-panel="timeline">Timeline</button>
    <button class="tab" data-panel="kanban">Kanban</button>
    <button class="tab" data-panel="people">Assignees</button>
    <button class="tab" data-panel="edit">Edit</button>
  </div>
  ${model.errors.length ? `<div class="errors">${model.errors.map(esc).join("<br>")}</div>` : ""}
  <div class="panel active" data-panel="timeline">${model.timelineHtml}</div>
  <div class="panel" data-panel="kanban">${model.kanbanHtml}</div>
  <div class="panel" data-panel="people">${model.peopleHtml}</div>
  <div class="panel" data-panel="edit"><textarea id="source-edit" spellcheck="false">${esc(model.source)}</textarea><div class="actions"><button class="save" id="save-source">Save</button></div></div>
  <div class="modal-overlay" id="task-modal">
    <div class="modal">
      <div class="grid">
        <label>Name<input data-f="name"></label>
        <label>Status<select data-f="status"><option value="new">New</option><option value="active">Active</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="paused">Paused</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
        <label>Assignees<input data-f="assignees" placeholder="@alice @bob"></label>
        <label>Tags<input data-f="tags" placeholder="#api #backend"></label>
        <label>Priority<select data-f="priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>Progress<input data-f="progress" type="number" min="0" max="100"></label>
        <label>Duration<input data-f="duration" placeholder="5d"></label>
        <label>ID<input data-f="id"></label>
        <label>Start<input data-f="startDate" placeholder="YYYY-MM-DD"></label>
        <label>Due<input data-f="dueDate" placeholder="YYYY-MM-DD"></label>
        <label>After<input data-f="after"></label>
        <label>Delayed<input data-f="delayed" placeholder="3d"></label>
        <label>Blocked<input data-f="blocked" placeholder="2w"></label>
        <textarea data-f="description" placeholder="Description"></textarea>
      </div>
      <div class="modal-actions">
        <button class="tab" id="cancel-modal">Cancel</button>
        <button class="save" id="save-modal">Save</button>
      </div>
    </div>
  </div>
<script>
const vscode = acquireVsCodeApi();
const state = { source: ${sourceJson}, tasks: ${tasksJson}, task: null };
const STATUS_SIGIL = { new:' ', active:'~', done:'x', blocked:'!', 'at-risk':'?', deferred:'>', cancelled:'_', review:'=', paused:'o' };

function findTask(line){ return state.tasks.find(t => Number(t.line) === Number(line)); }
function serializeTaskLine(t){
  const sig = STATUS_SIGIL[t.status] || ' ';
  const fields = [];
  if (t.id) fields.push('id:' + t.id);
  if (t.duration) fields.push(t.duration);
  if (t.assignees && t.assignees.length) fields.push(t.assignees.map(a=>'@'+a).join(' '));
  if (t.tags && t.tags.length) fields.push(t.tags.map(a=>'#'+a).join(' '));
  if (t.priority && t.priority !== 'normal') fields.push('!' + t.priority);
  if (t.progress != null && t.progress !== '') fields.push('%' + t.progress);
  if (t.startDate) fields.push('>' + t.startDate);
  if (t.dueDate) fields.push('<' + t.dueDate);
  if (t.after) fields.push('after:' + t.after);
  (t.modifiers || []).forEach(m => {
    const mm = /^(delayed|blocked):(.+)$/.exec(m);
    if (mm) fields.push(mm[1] + ' ' + mm[2]); else fields.push('+' + m);
  });
  return '[' + sig + '] ' + (t.name || '') + (fields.length ? ' | ' + fields.join(' | ') : '');
}
function patchSourceWithDescription(source, lineNum, newLine, descText){
  const lines = source.split('\\n');
  if (lineNum < 1 || lineNum > lines.length) return source;
  let oldDesc = 0, idx = lineNum;
  while (idx < lines.length && lines[idx].trimStart().startsWith('//')) { oldDesc++; idx++; }
  const add = [newLine];
  if (descText && descText.trim()) descText.trim().split('\\n').forEach(dl => add.push('// ' + dl.trim()));
  lines.splice(lineNum - 1, 1 + oldDesc, ...add);
  return lines.join('\\n');
}
function setView(p){
  document.querySelectorAll('.tab[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === p));
  document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.dataset.panel === p));
}
document.querySelectorAll('.tab[data-panel]').forEach(b => b.addEventListener('click', () => setView(b.dataset.panel)));

document.getElementById('save-source').addEventListener('click', () => {
  state.source = document.getElementById('source-edit').value;
  vscode.postMessage({ type: 'saveSource', source: state.source });
});

const modal = document.getElementById('task-modal');
function setField(f, v){ const el = modal.querySelector('[data-f="' + f + '"]'); if (el) el.value = v || ''; }
function getField(f){ const el = modal.querySelector('[data-f="' + f + '"]'); return el ? String(el.value || '').trim() : ''; }
function openTask(line){
  const t = findTask(line); if (!t) return;
  state.task = t;
  setField('name', t.name); setField('status', t.status); setField('assignees', (t.assignees||[]).map(a=>'@'+a).join(' '));
  setField('tags', (t.tags||[]).map(a=>'#'+a).join(' ')); setField('priority', t.priority || 'normal');
  setField('progress', t.progress != null ? String(t.progress) : ''); setField('duration', t.duration || '');
  setField('id', t.id || ''); setField('startDate', t.startDate || ''); setField('dueDate', t.dueDate || '');
  setField('after', t.after || ''); setField('description', t.description || '');
  setField('delayed', (t.modifiers||[]).find(m=>m.startsWith('delayed:'))?.slice(8) || '');
  setField('blocked', (t.modifiers||[]).find(m=>m.startsWith('blocked:'))?.slice(8) || '');
  modal.classList.add('open');
}
document.getElementById('cancel-modal').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
document.getElementById('save-modal').addEventListener('click', () => {
  if (!state.task) return;
  const u = { ...state.task };
  u.name = getField('name');
  u.status = getField('status') || 'new';
  u.assignees = getField('assignees').split(/\\s+/).map(a=>a.replace(/^@/,'')).filter(Boolean);
  u.tags = getField('tags').split(/\\s+/).map(a=>a.replace(/^#/,'')).filter(Boolean);
  u.priority = getField('priority') || 'normal';
  const pg = getField('progress'); u.progress = pg === '' ? undefined : Number(pg);
  u.duration = getField('duration') || undefined;
  u.id = getField('id') || undefined; u.startDate = getField('startDate') || undefined; u.dueDate = getField('dueDate') || undefined;
  u.after = getField('after') || ''; u.description = getField('description') || undefined;
  const baseMods = (u.modifiers || []).filter(m => !m.startsWith('delayed:') && !m.startsWith('blocked:'));
  const d = getField('delayed'); const b = getField('blocked'); if (d) baseMods.push('delayed:' + d); if (b) baseMods.push('blocked:' + b); u.modifiers = baseMods;
  state.source = patchSourceWithDescription(state.source, u.line, serializeTaskLine(u), u.description);
  document.getElementById('source-edit').value = state.source;
  modal.classList.remove('open');
  vscode.postMessage({ type: 'saveSource', source: state.source });
});

document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-line]');
  if (!row) return;
  openTask(row.getAttribute('data-line'));
});

let dragging = null;
document.querySelectorAll('.yvk-card[data-line]').forEach(card => {
  card.addEventListener('dragstart', () => { dragging = Number(card.dataset.line); card.classList.add('dragging'); });
  card.addEventListener('dragend', () => { dragging = null; card.classList.remove('dragging'); });
});
document.querySelectorAll('.yvk-col[data-status]').forEach(col => {
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', e => {
    e.preventDefault(); col.classList.remove('drag-over');
    if (dragging == null) return;
    const t = findTask(dragging); if (!t) return;
    const status = col.dataset.status; if (!status || t.status === status) return;
    const u = { ...t, status };
    state.source = patchSourceWithDescription(state.source, u.line, serializeTaskLine(u), u.description);
    document.getElementById('source-edit').value = state.source;
    vscode.postMessage({ type: 'saveSource', source: state.source });
  });
});
</script>
</body>
</html>`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate,
  extendMarkdownIt
});
