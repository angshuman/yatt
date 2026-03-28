// gen-animated-showcase.mjs
// Generates examples/animated-showcase.svg — a 3-slide animated SVG for the README
import { parse, schedule, renderGanttSVG } from '../dist/index.js';
import { writeFileSync } from 'fs';

const W = 820, H = 460;
const FONT = 'ui-sans-serif, system-ui, sans-serif';
const MONO = '"Cascadia Code", "Fira Code", ui-monospace, monospace';

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const attrs = o => Object.entries(o).map(([k,v]) => `${k}="${esc(String(v))}"`).join(' ');
const R = (x,y,w,h,a={}) => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${h}" ${attrs(a)}/>`;
const T = (x,y,s,a={}) => `<text x="${x}" y="${y}" ${attrs(a)}>${esc(s)}</text>`;
const L = (x1,y1,x2,y2,a={}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs(a)}/>`;
const C = (cx,cy,r,a={}) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs(a)}/>`;

// ── timing: 3 slides × 5s = 15s, 0.5s crossfade ─────────────────────────────
const TOTAL = 15, PER = 5, FADE = 0.5;
const p = s => (s / TOTAL * 100).toFixed(3) + '%';

function slideCSS(n) {
  const s0 = n * PER, s1 = s0 + PER;
  const fi = s0, fo = s1;
  if (n === 0) return `
@keyframes s0 {
  0%       { opacity:1; }
  ${p(s1-FADE)} { opacity:1; }
  ${p(fo)}   { opacity:0; }
  ${p(TOTAL-FADE)} { opacity:0; }
  100%     { opacity:1; }
}`;
  return `
@keyframes s${n} {
  0%       { opacity:0; }
  ${p(fi)}   { opacity:0; }
  ${p(fi+FADE)} { opacity:1; }
  ${p(s1-FADE)} { opacity:1; }
  ${p(fo)}   { opacity:0; }
  100%     { opacity:0; }
}`;
}

function dotCSS(n) {
  const s0 = n * PER, s1 = s0 + PER;
  if (n === 0) return `
@keyframes d0 {
  0%       { r:5; }
  ${p(s1-FADE)} { r:5; }
  ${p(s1)}   { r:3; }
  ${p(TOTAL-FADE)} { r:3; }
  100%     { r:5; }
}`;
  return `
@keyframes d${n} {
  0%       { r:3; }
  ${p(s0)}   { r:3; }
  ${p(s0+FADE)} { r:5; }
  ${p(s1-FADE)} { r:5; }
  ${p(s1)}   { r:3; }
  100%     { r:3; }
}`;
}

// ── Slide 1: Code editor ─────────────────────────────────────────────────────
function buildEditorSlide() {
  const parts = [];
  const BG = '#0d1117', PANEL = '#161b22', BORDER = '#30363d';
  const CODE_BG = '#0d1117';
  
  // Background
  parts.push(R(0, 0, W, H, { fill: BG }));
  
  // Headline
  parts.push(T(W/2, 38, 'Write tasks as plain text', {
    fill: '#f0f6fc', 'font-size': '18', 'font-weight': '700',
    'text-anchor': 'middle', 'font-family': FONT,
  }));
  parts.push(T(W/2, 58, 'One line per task · lives in .md files · tracked by git', {
    fill: '#7d8590', 'font-size': '12', 'text-anchor': 'middle', 'font-family': FONT,
  }));

  // Editor window
  const ex = 60, ey = 74, ew = W - 120, eh = H - 120;
  parts.push(R(ex, ey, ew, eh, { fill: PANEL, rx: '8', stroke: BORDER, 'stroke-width': '1' }));

  // Window chrome
  parts.push(R(ex, ey, ew, 28, { fill: '#21262d', rx: '8' }));
  parts.push(R(ex, ey + 14, ew, 14, { fill: '#21262d' }));
  parts.push(C(ex+14, ey+14, 5, { fill: '#ff5f57' }));
  parts.push(C(ex+30, ey+14, 5, { fill: '#febc2e' }));
  parts.push(C(ex+46, ey+14, 5, { fill: '#28c840' }));
  parts.push(T(W/2, ey+18, 'sprint.md', {
    fill: '#7d8590', 'font-size': '11', 'text-anchor': 'middle', 'font-family': FONT,
  }));

  // Code lines
  const cx = ex + 24, cy0 = ey + 44, lh = 20;
  const code = [
    [[ ['title: ', '#7d8590'], ['Sprint 12 — Auth & Onboarding', '#adbac7'] ]],
    [[ ['start: ', '#7d8590'], ['2026-04-07', '#adbac7'] ]],
    [],
    [[ ['[x] ', '#3fb950'], ['API design', '#f0f6fc'], ['  | 3d | ', '#5c6370'], ['@alice', '#d29922'], ['  | id:design', '#5c6370'] ]],
    [[ ['// ', '#5c6370'], ['Stakeholder review completed.', '#5c6370'] ]],
    [[ ['[~] ', '#58a6ff'], ['Backend auth', '#f0f6fc'], ['   | 5d | ', '#5c6370'], ['@bob', '#d29922'], ['   | %60 | after:design', '#5c6370'] ]],
    [[ ['    . ', '#5c6370'], ['OAuth provider setup', '#adbac7'], [' | 2d', '#5c6370'] ]],
    [[ ['    . ', '#5c6370'], ['Token validation', '#adbac7'], ['    | 3d', '#5c6370'] ]],
    [[ ['[ ] ', '#8b949e'], ['Frontend login UI', '#f0f6fc'], [' | 4d | ', '#5c6370'], ['@carol', '#d29922'], [' | after:design', '#5c6370'] ]],
    [[ ['[ ] ', '#8b949e'], ['Integration & QA', '#f0f6fc'], ['   | 3d | ', '#5c6370'], ['@alice @bob', '#d29922'], [' | after:*', '#5c6370'] ]],
    [],
    [[ ['>> ', '#e3b341'], ['Sprint Review', '#f0f6fc'], ['            | after:integration | ', '#5c6370'], ['+deadline', '#f85149'] ]],
  ];

  code.forEach((line, i) => {
    if (!line || !line[0]) return;
    let x = cx;
    line[0].forEach(([txt, color]) => {
      parts.push(T(x, cy0 + i * lh, txt, {
        fill: color, 'font-size': '12.5', 'font-family': MONO,
        'xml:space': 'preserve',
      }));
      x += txt.length * 7.5;
    });
  });

  // Blinking cursor on line 6
  const cursorY = cy0 + 5 * lh;
  const cursorX = cx + 7.5 * ('[~] Backend auth   | 5d | @bob   | %60 | after:design'.length + 1);
  parts.push(R(cursorX, cursorY - 12, 7, 14, {
    fill: '#58a6ff', opacity: '0.8',
    style: `animation: blink 1s step-end infinite;`,
  }));

  return parts.join('\n');
}

// ── Slide 2: Timeline ─────────────────────────────────────────────────────────
function buildTimelineSlide() {
  const parts = [];
  parts.push(R(0, 0, W, H, { fill: '#ffffff' }));

  parts.push(T(W/2, 36, 'Instant Gantt timeline', {
    fill: '#1e293b', 'font-size': '18', 'font-weight': '700',
    'text-anchor': 'middle', 'font-family': FONT,
  }));
  parts.push(T(W/2, 56, 'Hover any row for details · click to edit · today line drawn automatically', {
    fill: '#94a3b8', 'font-size': '12', 'text-anchor': 'middle', 'font-family': FONT,
  }));

  const source = `title: Sprint 12
start: 2026-04-07

[x] API design | id:design | 3d | @alice
>> Kickoff | after:design

parallel: backend | after:design
[~] OAuth setup    | 3d | @bob   | %70
[ ] Token service  | 2d | @bob
end: backend

parallel: frontend | after:design
[done] Login page  | 3d | @carol | %100
[~]    Dashboard   | 4d | @carol | %40 | delayed 2d
end: frontend

[ ] Integration & QA | 3d | @alice @bob | after:backend,frontend
>> Sprint Review      | after:integration | +deadline`;

  const { doc } = parse(source);
  schedule(doc);
  const svg = renderGanttSVG(doc, { width: W - 60, theme: 'light', rowHeight: 26, headerHeight: 36, padding: 12 });

  // Extract SVG content and embed inside a group with translation
  const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const gy = 68;
  parts.push(`<g transform="translate(30, ${gy})" clip-path="url(#gantt-clip)">`);
  parts.push(inner);
  parts.push('</g>');

  return parts.join('\n');
}

// ── Slide 3: Kanban ──────────────────────────────────────────────────────────
function buildKanbanSlide() {
  const parts = [];
  parts.push(R(0, 0, W, H, { fill: '#ffffff' }));

  parts.push(T(W/2, 36, 'Kanban board', {
    fill: '#1e293b', 'font-size': '18', 'font-weight': '700',
    'text-anchor': 'middle', 'font-family': FONT,
  }));
  parts.push(T(W/2, 56, 'Same data · drag to change status · empty columns collapse', {
    fill: '#94a3b8', 'font-size': '12', 'text-anchor': 'middle', 'font-family': FONT,
  }));

  const cols = [
    { status: 'new',      label: 'New',    color: '#93a8c4', cards: [
      { name: 'Token service', tags: ['#backend'] },
      { name: 'Integration & QA', assignees: ['AL','BO'] },
    ]},
    { status: 'active',   label: 'Active', color: '#6a9fd8', cards: [
      { name: 'OAuth setup', prog: 70, assignees: ['BO'] },
      { name: 'Dashboard', prog: 40, assignees: ['CA'], delayed: '2d' },
    ]},
    { status: 'review',   label: 'Review', color: '#8e7ec4', cards: [] },
    { status: 'blocked',  label: 'Blocked', color: '#c97070', cards: [] },
    { status: 'done',     label: 'Done',   color: '#6aab85', cards: [
      { name: 'API design', assignees: ['AL'] },
      { name: 'Login page', assignees: ['CA'] },
    ]},
    { status: 'cancelled', label: 'Cancelled', color: '#8a96a6', cards: [] },
  ];

  const fullCols   = cols.filter(c => c.cards.length > 0);
  const emptyCols  = cols.filter(c => c.cards.length === 0);
  const colW = 180, gap = 10, emptyW = 28;
  const totalW = fullCols.length * colW + (fullCols.length - 1) * gap + emptyCols.length * (emptyW + gap);
  const startX = (W - totalW) / 2;
  const colY = 72;

  let x = startX;
  for (const col of cols) {
    if (col.cards.length === 0) {
      // Collapsed column
      parts.push(R(x, colY, emptyW, H - colY - 16, {
        fill: '#f8fafc', rx: '5', stroke: '#e2e8f0', 'stroke-width': '1',
      }));
      // Colored accent strip
      parts.push(R(x + 4, colY + 8, 4, H - colY - 32, { fill: col.color, rx: '2', opacity: '0.4' }));
      // Vertical text
      parts.push(`<text x="${x + 20}" y="${colY + 100}" fill="${col.color}" font-size="9"
        font-family="${FONT}" font-weight="600" text-anchor="middle"
        transform="rotate(90, ${x + 20}, ${colY + 100})" opacity="0.7">${esc(col.label.toUpperCase())}</text>`);
      x += emptyW + gap;
    } else {
      // Full column
      const cardH = 60, cardGap = 6, headerH = 36;
      const colH = headerH + col.cards.length * (cardH + cardGap) + 10;
      parts.push(R(x, colY, colW, colH, {
        fill: '#f8fafc', rx: '6', stroke: '#e2e8f0', 'stroke-width': '1',
      }));
      // Header
      parts.push(R(x, colY, colW, headerH, { fill: '#f1f5f9', rx: '6' }));
      parts.push(R(x, colY + headerH - 8, colW, 8, { fill: '#f1f5f9' })); // square bottom of header
      parts.push(R(x + 10, colY + 13, 3, 10, { fill: col.color, rx: '1' }));
      parts.push(T(x + 20, colY + 22, col.label, {
        fill: '#1e293b', 'font-size': '11', 'font-weight': '600', 'font-family': FONT,
      }));
      parts.push(T(x + colW - 12, colY + 22, String(col.cards.length), {
        fill: '#94a3b8', 'font-size': '11', 'text-anchor': 'end', 'font-family': FONT,
      }));

      // Cards
      col.cards.forEach((card, ci) => {
        const cy = colY + headerH + ci * (cardH + cardGap) + 6;
        parts.push(R(x + 6, cy, colW - 12, cardH, {
          fill: '#ffffff', rx: '4', stroke: '#e2e8f0', 'stroke-width': '1',
        }));
        // Card name
        const name = card.name.length > 22 ? card.name.slice(0, 20) + '…' : card.name;
        parts.push(T(x + 14, cy + 15, name, {
          fill: '#1e293b', 'font-size': '11', 'font-family': FONT,
        }));
        // Delayed badge
        if (card.delayed) {
          parts.push(R(x + 14, cy + 22, 42, 13, { fill: 'rgba(245,158,11,0.12)', rx: '3' }));
          parts.push(T(x + 18, cy + 32, `⏱ ${card.delayed}`, {
            fill: '#c9a04a', 'font-size': '9', 'font-weight': '600', 'font-family': FONT,
          }));
        }
        // Progress bar
        if (card.prog != null) {
          const barX = x + 14, barY = cy + 40, barW = colW - 32;
          parts.push(R(barX, barY, barW, 4, { fill: '#e2e8f0', rx: '2' }));
          parts.push(R(barX, barY, barW * card.prog / 100, 4, { fill: col.color, rx: '2' }));
        }
        // Assignee circles
        if (card.assignees) {
          let ax = x + colW - 14;
          card.assignees.slice().reverse().forEach(a => {
            ax -= 16;
            parts.push(C(ax + 7, cy + 47, 8, { fill: '#f1f5f9', stroke: col.color, 'stroke-width': '1.5' }));
            parts.push(T(ax + 7, cy + 51, a.slice(0,2), {
              fill: '#1e293b', 'font-size': '6.5', 'font-weight': '700',
              'text-anchor': 'middle', 'font-family': FONT,
            }));
          });
        }
      });
      x += colW + gap;
    }
  }

  return parts.join('\n');
}

// ── Navigation dots ───────────────────────────────────────────────────────────
function buildDots(isDark) {
  const fill = isDark ? 'rgba(255,255,255,0.3)' : '#cbd5e1';
  const activeFill = isDark ? '#ffffff' : '#475569';
  const n = 3;
  const spacing = 16;
  const sx = W/2 - ((n-1) * spacing) / 2;
  const y = H - 12;
  return Array.from({length: n}, (_, i) => {
    return C(sx + i * spacing, y, 3, {
      fill: i === 0 ? activeFill : fill,
      style: `animation: d${i} ${TOTAL}s infinite;`,
    });
  }).join('\n');
}

// ── Slide label badges ────────────────────────────────────────────────────────
function slideLabel(txt, dark) {
  const fg = dark ? '#7d8590' : '#94a3b8';
  return T(W - 20, H - 10, txt, {
    fill: fg, 'font-size': '10', 'font-family': FONT, 'text-anchor': 'end',
  });
}

// ── Assemble ──────────────────────────────────────────────────────────────────

const ganttClipH = H - 68 - 8;
const css = `
  ${slideCSS(0)} ${slideCSS(1)} ${slideCSS(2)}
  ${dotCSS(0)} ${dotCSS(1)} ${dotCSS(2)}
  @keyframes blink { 0%,100%{opacity:0.8} 50%{opacity:0} }
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <style>${css}</style>
  <clipPath id="gantt-clip">
    <rect x="0" y="0" width="${W - 60}" height="${ganttClipH}"/>
  </clipPath>
  <filter id="shadow" x="-2%" y="-2%" width="104%" height="110%">
    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#00000018"/>
  </filter>
</defs>

<!-- outer frame -->
${R(0, 0, W, H, { fill: '#f1f5f9', rx: '12' })}
${R(4, 4, W-8, H-8, { fill: '#ffffff', rx: '10', filter: 'url(#shadow)' })}

<!-- Slide 1: Editor -->
<g style="animation: s0 ${TOTAL}s infinite; opacity:1;">
${buildEditorSlide()}
${buildDots(true)}
${slideLabel('1 / 3', true)}
</g>

<!-- Slide 2: Timeline -->
<g style="animation: s1 ${TOTAL}s infinite; opacity:0;">
${buildTimelineSlide()}
${buildDots(false)}
${slideLabel('2 / 3', false)}
</g>

<!-- Slide 3: Kanban -->
<g style="animation: s2 ${TOTAL}s infinite; opacity:0;">
${buildKanbanSlide()}
${buildDots(false)}
${slideLabel('3 / 3', false)}
</g>

</svg>`;

writeFileSync('examples/animated-showcase.svg', svg);
console.log('Written examples/animated-showcase.svg');
