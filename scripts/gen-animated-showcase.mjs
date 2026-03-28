// gen-animated-showcase.mjs
// 3-slide animated SVG: editor → timeline (dark browser) → kanban (dark browser)
import { parse, schedule, renderGanttSVG } from '../dist/index.js';
import { writeFileSync } from 'fs';

const W = 820, H = 490;
const FONT = 'ui-sans-serif, system-ui, sans-serif';
const MONO = '"Cascadia Code","Fira Code",ui-monospace,monospace';

// ── helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const at  = o => Object.entries(o).map(([k,v]) => `${k}="${esc(String(v))}"`).join(' ');
const R = (x,y,w,h,a={}) => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${h}" ${at(a)}/>`;
const T = (x,y,s,a={}) => `<text x="${x}" y="${y}" ${at(a)}>${esc(s)}</text>`;
const L = (x1,y1,x2,y2,a={}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${at(a)}/>`;
const C = (cx,cy,r,a={}) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${at(a)}/>`;

// ── timing: 3 slides × 5s = 15s, 0.5s crossfade ─────────────────────────────
const TOTAL = 15, PER = 5, FADE = 0.5;
const pct = s => (s / TOTAL * 100).toFixed(3) + '%';

function slideKF(n) {
  const s0 = n * PER, s1 = s0 + PER;
  if (n === 0) return `@keyframes s0{0%{opacity:1}${pct(s1-FADE)}{opacity:1}${pct(s1)}{opacity:0}${pct(TOTAL-FADE)}{opacity:0}100%{opacity:1}}`;
  return `@keyframes s${n}{0%{opacity:0}${pct(s0)}{opacity:0}${pct(s0+FADE)}{opacity:1}${pct(s1-FADE)}{opacity:1}${pct(s1)}{opacity:0}100%{opacity:0}}`;
}
function dotKF(n) {
  const s0 = n * PER, s1 = s0 + PER;
  if (n === 0) return `@keyframes d0{0%{r:5}${pct(s1-FADE)}{r:5}${pct(s1)}{r:3}${pct(TOTAL-FADE)}{r:3}100%{r:5}}`;
  return `@keyframes d${n}{0%{r:3}${pct(s0)}{r:3}${pct(s0+FADE)}{r:5}${pct(s1-FADE)}{r:5}${pct(s1)}{r:3}100%{r:3}}`;
}

// ── Shared: dark slide headline ───────────────────────────────────────────────
function headline(title, sub) {
  return [
    T(W/2, 30, title, { fill:'#f0f6fc','font-size':'16','font-weight':'700','text-anchor':'middle','font-family':FONT }),
    T(W/2, 48, sub,   { fill:'#7d8590','font-size':'11','text-anchor':'middle','font-family':FONT }),
  ].join('\n');
}

// ── Shared: browser window chrome ────────────────────────────────────────────
// Returns { html, contentY, contentH }
function browserChrome(ex, ey, ew, eh, activeTab) {
  const parts = [], titleH = 30, topbarH = 38;

  // Outer panel
  parts.push(R(ex, ey, ew, eh, { fill:'#161b22', rx:'8', stroke:'#30363d','stroke-width':'1' }));

  // Titlebar
  parts.push(R(ex, ey, ew, titleH, { fill:'#21262d', rx:'8' }));
  parts.push(R(ex, ey+titleH-8, ew, 8, { fill:'#21262d' }));
  [['#ff5f57',14],['#febc2e',30],['#28c840',46]].forEach(([col,ox]) =>
    parts.push(C(ex+ox, ey+15, 5, { fill:col }))
  );
  const urlW = 220, urlX = ex + (ew-urlW)/2;
  parts.push(R(urlX, ey+7, urlW, 16, { fill:'#0d1117', rx:'4' }));
  parts.push(T(ex+ew/2, ey+18, 'localhost:3000/sprint.md', {
    fill:'#7d8590','font-size':'9','text-anchor':'middle','font-family':FONT,
  }));

  // YATT topbar
  const tbY = ey + titleH;
  parts.push(R(ex, tbY, ew, topbarH, { fill:'#0d1117' }));
  parts.push(L(ex, tbY+topbarH, ex+ew, tbY+topbarH, { stroke:'#30363d','stroke-width':'1' }));
  parts.push(T(ex+14, tbY+24, 'YATT', {
    fill:'#58a6ff','font-size':'12','font-weight':'700','font-family':FONT,'letter-spacing':'0.1em',
  }));

  // Branch/git indicator
  parts.push(R(ex+ew-130, tbY+9, 80, 18, { fill:'#161b22', rx:'4', stroke:'#30363d','stroke-width':'1' }));
  parts.push(C(ex+ew-123, tbY+18, 3, { fill:'#3fb950' }));
  parts.push(T(ex+ew-116, tbY+22, 'main', { fill:'#7d8590','font-size':'9','font-family':FONT }));

  // Tabs
  const TABS = [['Timeline','timeline'],['Kanban','kanban'],['People','people'],['Edit','markdown']];
  let tx = ex + 65;
  TABS.forEach(([name, panel]) => {
    const active = panel === activeTab;
    const tw = name.length * 7 + 18;
    if (active) {
      parts.push(R(tx-2, tbY+6, tw+4, topbarH-6, { fill:'rgba(88,166,255,0.1)', rx:'4' }));
      parts.push(L(tx-2, tbY+topbarH, tx+tw+2, tbY+topbarH, { stroke:'#58a6ff','stroke-width':'2' }));
    }
    parts.push(T(tx+tw/2, tbY+24, name, {
      fill: active ? '#58a6ff' : '#6e7681',
      'font-size':'11', 'font-weight': active ? '600' : '400',
      'text-anchor':'middle', 'font-family':FONT,
    }));
    tx += tw + 6;
  });

  const contentY = tbY + topbarH;
  const contentH = eh - titleH - topbarH;
  return { html: parts.join('\n'), contentY, contentH };
}

// ── Nav dots ──────────────────────────────────────────────────────────────────
function navDots() {
  const sy = H - 14;
  return [0,1,2].map(i =>
    C(W/2 + (i-1)*16, sy, 3, {
      fill: i===0 ? '#c9d1d9' : 'rgba(255,255,255,0.2)',
      style: `animation: d${i} ${TOTAL}s infinite;`,
    })
  ).join('\n');
}

// ── SLIDE 1: Code editor ───────────────────────────────────────────────────────
function slide1() {
  const parts = [];
  parts.push(R(0,0,W,H,{fill:'#0d1117'}));
  parts.push(headline('Write tasks as plain text', 'One line per task · lives in .md files · tracked by git'));

  const ex=40, ey=58, ew=W-80, eh=H-78;
  parts.push(R(ex,ey,ew,eh,{fill:'#161b22',rx:'8',stroke:'#30363d','stroke-width':'1'}));
  // Terminal chrome
  parts.push(R(ex,ey,ew,28,{fill:'#21262d',rx:'8'}));
  parts.push(R(ex,ey+20,ew,8,{fill:'#21262d'}));
  [['#ff5f57',14],['#febc2e',30],['#28c840',46]].forEach(([col,ox]) =>
    parts.push(C(ex+ox, ey+14, 5, { fill:col }))
  );
  parts.push(T(W/2, ey+18, 'sprint.md', {fill:'#7d8590','font-size':'11','text-anchor':'middle','font-family':FONT}));

  const cx=ex+24, cy0=ey+44, lh=22;
  // [text, color] pairs per line; null = blank line
  const lines = [
    [[' title: ','#7d8590'],['Sprint 12 — Auth & Onboarding','#adbac7']],
    [[' start: ','#7d8590'],['2026-04-07','#adbac7']],
    null,
    [[' [x] ','#3fb950'],['API design','#f0f6fc'],['  | 3d | ','#5c6370'],['@alice','#d29922'],['  | id:design','#5c6370']],
    [[' //  ','#5c6370'],['Stakeholder review completed — scope locked.','#5c6370']],
    [[' [~] ','#58a6ff'],['Backend auth','#f0f6fc'],['  | 5d | ','#5c6370'],['@bob','#d29922'],['  | %60 | after:design','#5c6370']],
    [['     . ','#5c6370'],['OAuth provider setup','#adbac7'],['  | 2d','#5c6370']],
    [['     . ','#5c6370'],['Token validation','#adbac7'],['     | 3d','#5c6370']],
    [[' [ ] ','#8b949e'],['Frontend login UI','#f0f6fc'],['  | 4d | ','#5c6370'],['@carol','#d29922'],['  | after:design','#5c6370']],
    [[' [ ] ','#8b949e'],['Integration & QA','#f0f6fc'],['  | 3d | ','#5c6370'],['@alice @bob','#d29922'],['  | after:*','#5c6370']],
    null,
    [[' >> ','#e3b341'],['Sprint Review','#f0f6fc'],['  | after:integration | ','#5c6370'],['+deadline','#f85149']],
  ];

  lines.forEach((line, i) => {
    if (!line) return;
    let x = cx;
    line.forEach(([txt, col]) => {
      parts.push(T(x, cy0+i*lh, txt, {
        fill:col, 'font-size':'12.5', 'font-family':MONO, 'xml:space':'preserve',
      }));
      x += txt.length * 7.5;
    });
  });

  // blinking cursor on line 5 (backend auth)
  const curLine = 5;
  const curX = cx + '[~] Backend auth  | 5d | @bob  | %60 | after:design'.length * 7.5 + 2;
  parts.push(R(curX, cy0+curLine*lh-13, 7, 15, {
    fill:'#58a6ff', style:`animation:blink 1s step-end infinite;`,
  }));

  parts.push(navDots());
  return parts.join('\n');
}

// ── SLIDE 2: Timeline (dark, browser chrome) ──────────────────────────────────
function slide2() {
  const parts = [];
  parts.push(R(0,0,W,H,{fill:'#0d1117'}));
  parts.push(headline('Instant Gantt timeline', 'Hover any row for details · today line · click to edit'));

  const ex=40, ey=58, ew=W-80, eh=H-78;
  const { html: chrome, contentY, contentH } = browserChrome(ex, ey, ew, eh, 'timeline');
  parts.push(chrome);

  const source = `title: Sprint 12
start: 2026-04-07
[x] API design | id:design | 3d | @alice
>> Kickoff | after:design
parallel: backend | after:design
[~] OAuth setup   | 3d | @bob   | %70
[ ] Token service | 2d | @bob
end: backend
parallel: frontend | after:design
[done] Login page  | 3d | @carol | %100
[~]    Dashboard   | 4d | @carol | %40 | delayed 2d
end: frontend
[ ] Integration & QA | 3d | @alice @bob | after:backend,frontend
>> Sprint Review | after:integration | +deadline`;

  const { doc } = parse(source);
  schedule(doc);
  const ganttH = contentH - 4;
  const svg = renderGanttSVG(doc, {
    width: ew, theme: 'dark', rowHeight: 26, headerHeight: 34, padding: 14,
  });
  const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  parts.push(`<g transform="translate(${ex}, ${contentY})" clip-path="url(#c2)">`);
  parts.push(inner);
  parts.push('</g>');
  // Clip def will be in defs block
  parts._clip2 = { x: ex, y: contentY, w: ew, h: contentH };

  parts.push(navDots());
  return parts.join('\n');
}

// ── SLIDE 3: Kanban (dark, browser chrome) ───────────────────────────────────
function slide3() {
  const parts = [];
  parts.push(R(0,0,W,H,{fill:'#0d1117'}));
  parts.push(headline('Kanban board', 'Same data · drag to change status · empty columns collapse'));

  const ex=40, ey=58, ew=W-80, eh=H-78;
  const { html: chrome, contentY, contentH } = browserChrome(ex, ey, ew, eh, 'kanban');
  parts.push(chrome);

  // Content area background
  parts.push(R(ex, contentY, ew, contentH, { fill:'#0d1117' }));

  const cols = [
    { label:'New',      color:'#93a8c4', cards:[
      { name:'Token service', tags:['#backend'] },
      { name:'Integration & QA', assignees:['AL','BO'] },
    ]},
    { label:'Active',   color:'#6a9fd8', cards:[
      { name:'OAuth setup',  prog:70, assignees:['BO'] },
      { name:'Dashboard',    prog:40, assignees:['CA'], delayed:'2d' },
    ]},
    { label:'Review',   color:'#8e7ec4', cards:[] },
    { label:'Blocked',  color:'#c97070', cards:[] },
    { label:'Done',     color:'#6aab85', cards:[
      { name:'API design',  assignees:['AL'] },
      { name:'Login page',  assignees:['CA'] },
    ]},
    { label:'Cancelled',color:'#8a96a6', cards:[] },
  ];

  const cardH=64, cardGap=6, headerH=36, emptyW=26, fullW=170, colGap=8;
  const fullCount = cols.filter(c=>c.cards.length).length;
  const emptyCount = cols.filter(c=>!c.cards.length).length;
  const totalW = fullCount*fullW + (fullCount-1)*colGap + emptyCount*(emptyW+colGap);
  let x = ex + (ew - totalW) / 2;
  const colTop = contentY + 10;

  cols.forEach(col => {
    if (!col.cards.length) {
      const colH = contentH - 20;
      parts.push(R(x, colTop, emptyW, colH, { fill:'#161b22', rx:'5', stroke:'#30363d','stroke-width':'1' }));
      parts.push(R(x+4, colTop+8, 3, colH-20, { fill:col.color, rx:'1', opacity:'0.35' }));
      parts.push(`<text x="${x+emptyW/2+1}" y="${colTop+90}" fill="${col.color}"
        font-size="8.5" font-family="${FONT}" font-weight="600" text-anchor="middle"
        transform="rotate(90,${x+emptyW/2+1},${colTop+90})" opacity="0.6"
        >${esc(col.label.toUpperCase())}</text>`);
      x += emptyW + colGap;
    } else {
      const colH = headerH + col.cards.length*(cardH+cardGap) + 8;
      parts.push(R(x, colTop, fullW, colH, { fill:'#161b22', rx:'6', stroke:'#30363d','stroke-width':'1' }));
      // Column header
      parts.push(R(x, colTop, fullW, headerH, { fill:'#1c2128', rx:'6' }));
      parts.push(R(x, colTop+headerH-8, fullW, 8, { fill:'#1c2128' }));
      parts.push(R(x+10, colTop+13, 3, 10, { fill:col.color, rx:'1' }));
      parts.push(T(x+20, colTop+22, col.label, { fill:'#adbac7','font-size':'11','font-weight':'600','font-family':FONT }));
      parts.push(T(x+fullW-10, colTop+22, String(col.cards.length), { fill:'#7d8590','font-size':'11','text-anchor':'end','font-family':FONT }));

      col.cards.forEach((card,ci) => {
        const cy = colTop + headerH + ci*(cardH+cardGap) + 4;
        parts.push(R(x+5, cy, fullW-10, cardH, { fill:'#1c2128', rx:'4', stroke:'#30363d','stroke-width':'1' }));
        const name = card.name.length > 20 ? card.name.slice(0,18)+'…' : card.name;
        parts.push(T(x+13, cy+15, name, { fill:'#f0f6fc','font-size':'11','font-family':FONT }));
        if (card.delayed) {
          parts.push(R(x+13, cy+21, 40, 13, { fill:'rgba(194,148,58,0.15)', rx:'3' }));
          parts.push(T(x+16, cy+31, `⏱ ${card.delayed}`, { fill:'#c9a04a','font-size':'9','font-weight':'600','font-family':FONT }));
        }
        if (card.prog != null) {
          const bx=x+13, by=cy+43, bw=fullW-30;
          parts.push(R(bx, by, bw, 4, { fill:'#30363d', rx:'2' }));
          parts.push(R(bx, by, bw*card.prog/100, 4, { fill:col.color, rx:'2' }));
        }
        if (card.assignees) {
          let ax = x+fullW-14;
          card.assignees.slice().reverse().forEach(a => {
            ax -= 17;
            parts.push(C(ax+7, cy+52, 8, { fill:'#21262d', stroke:col.color,'stroke-width':'1.5' }));
            parts.push(T(ax+7, cy+56, a.slice(0,2), { fill:'#adbac7','font-size':'6.5','font-weight':'700','text-anchor':'middle','font-family':FONT }));
          });
        }
      });
      x += fullW + colGap;
    }
  });

  parts.push(navDots());
  return parts.join('\n');
}

// ── Assemble ──────────────────────────────────────────────────────────────────
const css = [0,1,2].map(slideKF).join(' ') + ' ' + [0,1,2].map(dotKF).join(' ') +
  ' @keyframes blink{0%,100%{opacity:0.8}50%{opacity:0}}';

const s2 = slide2();
const s2clip = `<clipPath id="c2"><rect x="40" y="${40+30+38}" width="${W-80}" height="${H-78-68}"/></clipPath>`;

const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <style>${css}</style>
  ${s2clip}
</defs>

<!-- outer border -->
${R(0,0,W,H,{rx:'12',fill:'#0d1117'})}
${R(2,2,W-4,H-4,{rx:'11',fill:'#0d1117',stroke:'#30363d','stroke-width':'1'})}

<!-- Slide 1: editor -->
<g style="animation:s0 ${TOTAL}s infinite;opacity:1;">${slide1()}</g>

<!-- Slide 2: timeline -->
<g style="animation:s1 ${TOTAL}s infinite;opacity:0;">${s2}</g>

<!-- Slide 3: kanban -->
<g style="animation:s2 ${TOTAL}s infinite;opacity:0;">${slide3()}</g>

</svg>`;

writeFileSync('examples/animated-showcase.svg', out);
console.log(`Written examples/animated-showcase.svg (${out.length} bytes)`);
