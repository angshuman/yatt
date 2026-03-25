# YATT — Yet Another Task Tracker

Plain-text Gantt charts that live inside Markdown.

![build](https://img.shields.io/badge/build-passing-brightgreen)
![npm](https://img.shields.io/npm/v/yatt)
![license](https://img.shields.io/badge/license-MIT-blue)

---

## Example

~~~yatt
title: Mobile App v2.0
start: 2026-01-05
schedule: business-days

# Discovery

[x] Stakeholder interviews    | 3d  | @alice | #research | %100
[x] Competitive analysis      | 2d  | @bob   | #research | %100

# Design

[~] Wireframes                | 5d  | @alice | %60 | id:wireframes
[ ] Visual design             | 4d  | @alice | after:wireframes
>> Design sign-off            | >2026-01-26 | +deadline | id:design-done

# Development

parallel: frontend | after:design-done
[~] Component library         | 3d  | @carol | %40 | $APP-101
[ ] Page templates            | 4d  | @carol | after:components | id:components
end: frontend

parallel: backend | after:design-done
[ ] API endpoints             | 5d  | @dave  | $APP-102 | id:api
[ ] Auth service              | 2d  | @dave  | after:api
end: backend

# Release

[ ] Integration testing       | 3d  | @eve   | after:frontend,backend
[ ] Deploy to production      | 1d  | @dave  | !critical | after:frontend,backend
>> Launch                     | +deadline | id:launch
~~~

## Quick Start

```bash
npm install yatt
```

```js
import { parse, render } from 'yatt'

const doc = parse(source)
const svg = render(doc, { theme: 'default', width: 900 })
```

## Documentation

- [SPEC.md](./SPEC.md) — Full language specification
- [docs/syntax.md](./docs/syntax.md) — Tutorial-style syntax guide
- [docs/integrations.md](./docs/integrations.md) — VS Code, Obsidian, Remark, Browser
- [examples/](./examples/) — Realistic example files

## Integrations

| Environment | How | Source |
|---|---|---|
| VS Code | Extension — renders `yatt` fences in Markdown preview | [integrations/vscode/](./integrations/vscode/) |
| Obsidian | Community plugin — live preview in notes | [integrations/obsidian/](./integrations/obsidian/) |
| Remark / MDX | `remarkYatt` plugin for Docusaurus, Next.js, Astro | [integrations/remark/](./integrations/remark/) |
| Browser | Standalone `<script>` tag, no framework needed | [integrations/browser/](./integrations/browser/) |

## License

MIT
