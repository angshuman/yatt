/**
 * remark-yatt: renders ```yatt code fences as Gantt/list HTML, or interactive control placeholders.
 *
 * Usage in Docusaurus (docusaurus.config.js):
 *   import { remarkYatt } from 'remark-yatt'
 *   ...
 *   remarkPlugins: [remarkYatt]
 *
 * Usage in Next.js with @next/mdx:
 *   import { remarkYatt } from 'remark-yatt'
 *   ...
 *   options: { remarkPlugins: [remarkYatt] }
 *
 * Usage with unified directly:
 *   import { unified } from 'unified'
 *   import remarkParse from 'remark-parse'
 *   import { remarkYatt } from 'remark-yatt'
 *   import remarkRehype from 'remark-rehype'
 *   import rehypeStringify from 'rehype-stringify'
 *
 *   const result = await unified()
 *     .use(remarkParse)
 *     .use(remarkYatt)
 *     .use(remarkRehype, { allowDangerousHtml: true })
 *     .use(rehypeStringify, { allowDangerousHtml: true })
 *     .process(markdown)
 */

import type { Plugin } from 'unified';
import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';
import { render } from 'yatt';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RemarkYattOptions {
  /** Output format. Default: 'control' */
  format?: 'gantt' | 'list' | 'control';
  /** If true, parse errors are embedded as HTML comments rather than thrown. Default: true */
  softErrors?: boolean;
}

export const remarkYatt: Plugin<[RemarkYattOptions?], Root> = (options = {}) => {
  const format = options.format ?? 'control';
  const softErrors = options.softErrors ?? true;

  return (tree) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (node.lang !== 'yatt' || !parent || index === undefined) return;

      try {
        const preview = render(node.value, 'gantt');
        const errors = preview.errors;
        const html = format === 'control'
          ? `<pre data-yatt data-yatt-format="control">${escapeHtml(node.value)}</pre>`
          : render(node.value, format).html;

        const errorComment = errors.length && softErrors
          ? `<!-- yatt warnings:\n${errors.map(e => `  Line ${e.line}: ${e.message}`).join('\n')}\n-->`
          : '';

        // Replace the code node with a raw HTML node (hast-compatible)
        const htmlNode = {
          type: 'html' as const,
          value: `<div class="yatt-block">${errorComment}${html}</div>`,
        };

        parent.children.splice(index, 1, htmlNode as any);
      } catch (err) {
        if (!softErrors) throw err;
        const htmlNode = {
          type: 'html' as const,
          value: `<!-- yatt error: ${err} -->`,
        };
        parent.children.splice(index, 1, htmlNode as any);
      }
    });
  };
};

export default remarkYatt;
