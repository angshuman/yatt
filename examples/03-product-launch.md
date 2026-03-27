# Product Launch

A phased product launch with milestones, subtasks, and cross-phase dependencies.

```yatt
title: Product v2.0 Launch
owner: @pm
start: 2026-04-01
schedule: business-days

## Phase 1 — Discovery

[x] Market research | 5bd | @research | #research
[x] Competitor analysis | 3bd | @research | #comp-analysis | after:research
[ ] User interviews | 4bd | @ux | #interviews | after:research
// 12 interviews scheduled across three customer segments. Synthesis in Notion.
>> Discovery Complete | #discovery-done | after:comp-analysis,interviews

## Phase 2 — Design

[ ] Brand identity | 6bd | @design | #brand | after:discovery-done
.   Logo & icon set | 2bd | @design
.   Colour system & tokens | 2bd | @design
.   Typography scale | 1bd | @design
.   Brand guidelines PDF | 1bd | @design
[ ] UI/UX wireframes | 5bd | @ux | #wireframes | after:discovery-done
.   Information architecture | 1bd | @ux
.   Low-fidelity flows | 2bd | @ux
.   High-fidelity screens | 2bd | @ux
[ ] Design system | 4bd | @design | #design-system | after:brand,wireframes
>> Design Complete | #design-done | after:design-system

## Phase 3 — Engineering

[ ] Backend API | 10bd | @eng | #api | after:design-done
.   Auth & permissions | 3bd | @alice
.   Core resource endpoints | 5bd | @bob
.   Integration test suite | 2bd | @alice
[ ] Frontend | 8bd | @eng | #frontend | after:design-done
.   Component library | 3bd | @carol | #components
.   Page implementations | 4bd | @carol | after:components
.   End-to-end tests | 2bd | @dave
[ ] Mobile app | 6bd | @mobile | #mobile | after:design-done
.   iOS | 3bd | @eve
.   Android | 3bd | @frank
>> Code Complete | #code-done | after:api,frontend,mobile

## Phase 4 — Launch

[ ] Beta programme | 5bd | @qa | #beta | after:code-done
// Targeting 50 design-partner customers. NDA required. Feedback tracked in Linear.
[ ] Bug fixes & polish | 3bd | @eng | #bugfix | after:beta
[ ] Marketing campaign | 5bd | @marketing | #campaign | +fixed | >2026-06-01
[ ] Sales enablement | 3bd | @sales | #sales-en | after:design-done
>> Public Launch | after:bugfix,campaign,sales-en
```
