/**
 * YATT Obsidian Plugin
 *
 * Installation:
 *   1. Copy this folder to <vault>/.obsidian/plugins/yatt/
 *   2. Run `npm install && npm run build` inside the folder
 *   3. Enable the plugin in Obsidian: Settings → Community Plugins → YATT
 *
 * Usage: create a ```yatt code block in any note.
 */

import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import { mountInteractiveControl } from 'yatt';

export default class YattPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      'yatt',
      this.processYattBlock.bind(this)
    );

    this.addCommand({
      id: 'insert-yatt-block',
      name: 'Insert YATT task block',
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const snippet = '```yatt\ntitle: My Project\n\n[new] First task | 1d | @me\n[new] Second task | 2d\n```\n';
        editor.replaceRange(snippet, cursor);
        editor.setCursor({ line: cursor.line + 2, ch: 0 });
      },
    });
  }

  private processYattBlock(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ) {
    const container = el.createDiv({ cls: 'yatt-container' });
    mountInteractiveControl(container, source, { editable: true, allowPopup: true, theme: 'dark' });
  }

  onunload() {}
}
