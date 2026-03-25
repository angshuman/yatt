# YATT Integrations

This guide covers how to use YATT in four environments: VS Code, Obsidian, Remark/MDX, and the browser. Each integration renders `yatt` fenced code blocks as live Gantt charts without any changes to your underlying Markdown files.

---

## Why Fenced Code Blocks?

YATT uses fenced code blocks as its primary embedding mechanism:

~~~markdown
```yatt
title: My Project
start: 2026-01-05

[~] Task one | 3d | @alice
[ ] Task two | 2d | @bob
```
~~~

This is the right choice for several reasons:

1. **Fallback gracefully.** In any Markdown renderer that does not know about YATT, the block is rendered as a monospaced code block — fully readable as plain text.
2. **No custom syntax required.** Standard fenced code block parsing is implemented in every Markdown processor. YATT doesn't need its own file watcher or preprocessor to integrate with an existing toolchain.
3. **Language identifier routing.** The `yatt` language identifier is the only hook needed for each integration layer to intercept the block and hand it to the YATT renderer.
4. **Composable with prose.** Project plans often live inside larger documents — a design doc, a team wiki page, a README. Fenced blocks allow a Gantt chart to sit inline between paragraphs of text.

---

## VS Code

### Installation

When published to the VS Code Marketplace:

```
ext install yatt
```

Or search for "YATT" in the Extensions panel.

Source: [integrations/vscode/](../integrations/vscode/)

### How It Works

The VS Code extension hooks into the built-in Markdown preview via VS Code's `markdown.markdownItPlugins` contribution point. This API allows extensions to register custom [markdown-it](https://github.com/markdown-it/markdown-it) plugins that run during Markdown preview rendering.

The YATT extension registers a fence handler for the `yatt` language identifier. When the Markdown preview encounters a `yatt` code block, it calls the YATT renderer and injects the resulting SVG (or interactive HTML) directly into the preview panel DOM.

**Contribution point used:**

```json
{
  "contributes": {
    "markdown.markdownItPlugins": true
  }
}
```

**Plugin registration (inside the extension's `extendMarkdownIt` export):**

```js
exports.extendMarkdownIt = function (md) {
  md.use(require('yatt/markdown-it'))
  return md
}
```

### .yatt File Support

In addition to Markdown preview integration, the extension provides first-class support for standalone `.yatt` files:

- Syntax highlighting (TextMate grammar)
- Bracket matching for `[`, `]`, `parallel:`/`end:` pairs
- Hover documentation for field sigils
- A split-pane live preview command: `YATT: Open Preview to the Side`
- Diagnostics (squiggles) for parse errors and duplicate IDs

### Configuration

| Setting | Default | Description |
|---|---|---|
| `yatt.theme` | `"default"` | Color theme: `"default"`, `"dark"`, `"minimal"`, `"print"` |
| `yatt.defaultWidth` | `900` | Rendered chart width in pixels |
| `yatt.showTodayLine` | `true` | Draw a vertical line at today's date |
| `yatt.showDependencyArrows` | `false` | Draw arrows between dependent tasks |

---

## Obsidian

### Installation

1. Open Obsidian → Settings → Community Plugins.
2. Click "Browse" and search for "YATT".
3. Install and enable the plugin.

Source: [integrations/obsidian/](../integrations/obsidian/)

### How It Works

The Obsidian plugin uses the `registerMarkdownCodeBlockProcessor` API:

```js
this.registerMarkdownCodeBlockProcessor('yatt', (source, el, ctx) => {
  const doc = parse(source)
  const svg = render(doc, { width: el.clientWidth || 800 })
  el.innerHTML = svg
})
```

This API is called once per `yatt` fenced block on each page render. The YATT plugin parses the block source, calls the renderer, and injects the output SVG into the element Obsidian provides. The chart updates automatically when the note is edited (Obsidian re-invokes the processor on each Live Preview update).

### Live Preview vs. Reading Mode

The plugin works in both Obsidian modes:

- **Live Preview**: The chart renders inline as you type. Edits to the code block trigger a re-render with a short debounce (300 ms).
- **Reading Mode**: The chart is rendered once when the note is opened.

### Configuration

Open Obsidian Settings → YATT to configure:

- **Theme**: Default, Dark, Minimal, Print
- **Chart width**: Fixed pixel width or `"auto"` to fill the note width
- **Today line**: Toggle the vertical today indicator
- **Dependency arrows**: Toggle connector lines

---

## Remark / MDX

Use YATT in any remark-based pipeline: Docusaurus, Next.js with `@next/mdx`, Astro, or any Node.js build process.

Source: [integrations/remark/](../integrations/remark/)

### Installation

```bash
npm install yatt
```

### Usage

```js
import { remarkYatt } from 'yatt/remark'
```

#### Docusaurus (`docusaurus.config.js`)

```js
export default {
  presets: [
    [
      'classic',
      {
        docs: {
          remarkPlugins: [remarkYatt],
        },
        blog: {
          remarkPlugins: [remarkYatt],
        },
      },
    ],
  ],
}
```

#### Next.js (`next.config.js` with `@next/mdx`)

```js
import createMDX from '@next/mdx'
import { remarkYatt } from 'yatt/remark'

const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkYatt],
  },
})

export default withMDX({ pageExtensions: ['js', 'jsx', 'md', 'mdx'] })
```

#### Astro (`astro.config.mjs`)

```js
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import { remarkYatt } from 'yatt/remark'

export default defineConfig({
  integrations: [mdx()],
  markdown: {
    remarkPlugins: [remarkYatt],
  },
})
```

### Output Modes

The `remarkYatt` plugin supports two output modes, configured via options:

```js
remarkPlugins: [[remarkYatt, { output: 'svg' }]]
// or
remarkPlugins: [[remarkYatt, { output: 'component' }]]
```

| Mode | Description |
|---|---|
| `'svg'` (default) | Transforms the code block into an inline `<svg>` element. Zero JavaScript runtime overhead. Works anywhere HTML is rendered. |
| `'component'` | Transforms the code block into a `<YattChart>` React/Preact/Svelte component import. Enables interactivity (hover tooltips, zoom). Requires a framework. |

### Plugin Options

```js
remarkYatt({
  output: 'svg',           // 'svg' | 'component'
  theme: 'default',        // 'default' | 'dark' | 'minimal' | 'print'
  width: 900,              // chart width in pixels
  showTodayLine: true,     // draw today line
  className: 'yatt-chart', // CSS class on wrapper element
})
```

---

## Browser (Standalone)

Use YATT on any web page with a single `<script>` tag. No build step, no framework, no npm.

Source: [integrations/browser/](../integrations/browser/)

### Installation

```html
<script src="https://cdn.jsdelivr.net/npm/yatt/browser/yatt.min.js"></script>
```

Or self-host the file from the npm package's `browser/` directory.

### Auto-Render

When the script loads, it scans the page for YATT blocks and renders them automatically. Two element patterns are recognized:

**Fenced code blocks from Markdown renderers** (e.g., after running a Markdown-to-HTML pipeline that doesn't know about YATT):

```html
<pre><code class="language-yatt">
title: My Project
start: 2026-01-05

[~] Task one | 3d | @alice
[ ] Task two | 2d
</code></pre>
```

**Explicit data attribute** (for hand-authored HTML):

```html
<pre data-yatt>
title: My Project
start: 2026-01-05

[~] Task one | 3d | @alice
[ ] Task two | 2d
</pre>
```

Both forms are replaced with a rendered SVG chart in-place.

### Manual Rendering

If you need programmatic control:

```html
<script src="https://cdn.jsdelivr.net/npm/yatt/browser/yatt.min.js"></script>
<script>
  // Disable auto-render
  window.YATT_AUTORENDER = false

  document.addEventListener('DOMContentLoaded', () => {
    const source = document.getElementById('my-plan').textContent
    const svg = YATT.render(YATT.parse(source), { theme: 'dark', width: 1200 })
    document.getElementById('chart-container').innerHTML = svg
  })
</script>
```

### Configuration via Data Attributes

```html
<pre data-yatt data-yatt-theme="dark" data-yatt-width="1100" data-yatt-today-line="false">
title: My Project
...
</pre>
```

| Attribute | Default | Description |
|---|---|---|
| `data-yatt-theme` | `"default"` | Color theme |
| `data-yatt-width` | `"auto"` | Chart width (pixels or `"auto"`) |
| `data-yatt-today-line` | `"true"` | Show today line |
| `data-yatt-dependency-arrows` | `"false"` | Show dependency arrows |

### Bundle Size

| File | Size (gzip) |
|---|---|
| `yatt.min.js` | ~28 kB |
| `yatt.min.js` (SVG only, no interactivity) | ~18 kB |

---

## Comparison of Integration Approaches

| Dimension | VS Code | Obsidian | Remark/MDX | Browser |
|---|---|---|---|---|
| Build step required | No | No | Yes | No |
| Works offline | Yes | Yes | Yes (build time) | Yes (after load) |
| Interactivity | Yes (extension) | Limited | Yes (component mode) | Limited |
| Output format | SVG/HTML in preview | SVG in note | SVG or component | SVG in page |
| Affects source file | No | No | No | No |
| Setup complexity | Low | Low | Medium | Very low |
| Best for | Daily editing | Personal knowledge base | Static sites, docs | Simple web embeds |

---

## markdown-it Plugin Architecture

All of the above integrations (except the browser standalone) use a shared `markdown-it` plugin as their foundation. Understanding how this works helps if you need to build a custom integration.

markdown-it processes Markdown in two passes: tokenization and rendering. Fenced code blocks produce a `fence` token with a `info` property containing the language identifier and optionally additional attributes. The YATT markdown-it plugin intercepts the rendering of `fence` tokens where `info` starts with `yatt`:

```js
// Simplified plugin implementation
export function markdownItYatt(md, options = {}) {
  const defaultFenceRenderer = md.renderer.rules.fence

  md.renderer.rules.fence = function (tokens, idx, opts, env, self) {
    const token = tokens[idx]
    const lang = token.info.trim().split(/\s+/)[0]

    if (lang !== 'yatt') {
      // Fall through to default renderer for all other languages
      return defaultFenceRenderer
        ? defaultFenceRenderer(tokens, idx, opts, env, self)
        : self.renderToken(tokens, idx, opts)
    }

    try {
      const doc = parse(token.content)
      return render(doc, options)
    } catch (err) {
      return `<pre class="yatt-error">${escapeHtml(err.message)}</pre>`
    }
  }
}
```

The plugin pattern is the same whether you're running in VS Code's Markdown preview, a static site generator, or a custom rendering pipeline. The `parse` and `render` functions from the core `yatt` package are the single source of truth.
