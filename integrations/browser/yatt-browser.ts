/**
 * YATT Browser Integration — standalone script, no framework required.
 *
 * Usage:
 *   <script src="yatt.min.js"></script>
 *
 * Auto-renders any of these patterns on DOMContentLoaded:
 *   <pre><code class="language-yatt">...</code></pre>   (standard markdown output)
 *   <pre data-yatt>...</pre>
 *   <div data-yatt>...</div>
 *   <script type="text/yatt">...</script>              (hidden source pattern)
 *
 * Manual usage:
 *   window.yatt.render(source, 'gantt')  → { html, errors }
 *   window.yatt.renderAll()              → re-scans and renders all blocks
 */

import { render, parse, validate, schedule } from 'yatt';

type Format = 'gantt' | 'list';

function renderBlock(source: string, format: Format = 'gantt'): string {
  const { html, errors } = render(source, format);
  const errHtml = errors
    .filter(e => e.severity === 'error')
    .map(e => `<p class="yatt-error" style="color:#ef4444;font-size:12px;margin:4px 0">⚠ Line ${e.line}: ${e.message}</p>`)
    .join('');
  return `<div class="yatt-block" style="overflow-x:auto">${errHtml}${html}</div>`;
}

function renderAll(root: ParentNode = document): void {
  // Pattern 1: <code class="language-yatt"> inside <pre>
  root.querySelectorAll<HTMLElement>('pre code.language-yatt').forEach(el => {
    const pre = el.parentElement!;
    const format = (pre.dataset.yattFormat as Format) ?? 'gantt';
    const div = document.createElement('div');
    div.innerHTML = renderBlock(el.textContent ?? '', format);
    pre.replaceWith(div.firstElementChild!);
  });

  // Pattern 2: <pre data-yatt> or <div data-yatt>
  root.querySelectorAll<HTMLElement>('[data-yatt]:not([data-yatt-rendered])').forEach(el => {
    const format = (el.dataset.yattFormat as Format) ?? 'gantt';
    const source = el.textContent ?? '';
    el.innerHTML = renderBlock(source, format);
    el.dataset.yattRendered = '1';
    el.removeAttribute('data-yatt');
  });

  // Pattern 3: <script type="text/yatt">
  root.querySelectorAll<HTMLScriptElement>('script[type="text/yatt"]').forEach(el => {
    const format = (el.dataset.yattFormat as Format) ?? 'gantt';
    const div = document.createElement('div');
    div.innerHTML = renderBlock(el.textContent ?? '', format);
    el.replaceWith(div.firstElementChild!);
  });
}

// Expose as window.yatt
declare global {
  interface Window {
    yatt: {
      render: typeof render;
      renderAll: typeof renderAll;
      parse: typeof parse;
      validate: typeof validate;
      schedule: typeof schedule;
    };
  }
}

window.yatt = { render, renderAll, parse, validate, schedule };

// Auto-render on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => renderAll());
} else {
  renderAll();
}

export {};
