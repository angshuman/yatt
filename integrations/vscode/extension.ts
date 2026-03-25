import * as vscode from 'vscode';
import type { MarkdownIt } from 'vscode';

// Loaded lazily so the extension activates fast
let yatt: typeof import('yatt') | null = null;

async function getYatt() {
  if (!yatt) {
    yatt = await import('yatt');
  }
  return yatt;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('yatt.openPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const source = editor.document.getText();
      const lib = await getYatt();
      const { html } = lib.render(source, 'gantt');

      const panel = vscode.window.createWebviewPanel(
        'yattGantt',
        'YATT Gantt',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );

      panel.webview.html = wrapHtml(html, editor.document.fileName);
    })
  );
}

export function deactivate() {}

// Called by VS Code to extend the built-in markdown-it instance.
// This makes ```yatt fences render in the Markdown preview.
export async function extendMarkdownIt(md: MarkdownIt) {
  const lib = await getYatt();
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules) ?? (() => '');

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() !== 'yatt') {
      return defaultFence(tokens, idx, options, env, self);
    }

    try {
      const { html, errors } = lib.render(token.content, 'gantt');
      const errorHtml = errors.length
        ? `<div class="yatt-errors">${errors.map(e => `<p class="yatt-error">Line ${e.line}: ${e.message}</p>`).join('')}</div>`
        : '';
      return `<div class="yatt-gantt">${errorHtml}${html}</div>`;
    } catch (err) {
      return `<div class="yatt-error">YATT render error: ${err}</div>`;
    }
  };

  return md;
}

function wrapHtml(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — YATT Gantt</title>
<style>
  body { margin: 0; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  .yatt-error { color: var(--vscode-errorForeground); font-size: 12px; padding: 4px 8px; }
</style>
</head>
<body>${body}</body>
</html>`;
}
