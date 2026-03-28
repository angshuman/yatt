import { parse, schedule, renderGanttSVG } from '../dist/index.js';
import { writeFileSync } from 'fs';

const source = `title: Product v2 Launch
start: 2026-04-07

[x] Discovery & planning | id:phase1 | 5d | @alice
// Stakeholder interviews, competitive analysis, scope definition.
>> Kickoff complete | after:phase1

parallel: design | after:phase1
[done] UX wireframes  | 4d | @carol | %100
[~]    Visual design  | 3d | @carol | %70 | delayed 2d
// Brand tokens and component library in progress.
end: design

parallel: engineering | after:phase1
[x] API scaffold  | id:api | 4d | @bob | blocked 1w
// External auth provider blocked setup for a week.
[~] Auth service  | 4d | @bob   | after:api | %60
[ ] Core features | 1w | @alice | after:api
end: engineering

[ ] Integration & QA | id:qa | 5d | @alice @bob | after:design,engineering
[~] Performance testing | 2d | @bob | after:qa | %30
>> v2.0 Release | after:qa | +deadline`;

const { doc } = parse(source);
schedule(doc);
const svg = renderGanttSVG(doc, { width: 960, theme: 'light' });
writeFileSync('examples/showcase.svg', svg);
console.log('Written examples/showcase.svg');
