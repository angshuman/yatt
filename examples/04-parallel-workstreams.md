# Parallel Workstreams

Multiple independent workstreams running concurrently, converging on shared milestones.

```yatt
title: Platform Migration
owner: @cto
start: 2026-04-07
schedule: business-days

[ ] Architecture review & kickoff | 2bd | @cto | !critical | #kickoff
// Agree on strangler-fig migration strategy. Output: ADR doc + updated C4 diagrams.

parallel: Backend | after:kickoff
[ ] Audit existing APIs 2 | id:api-audit | 3bd | @alice
  [ ] Design new data schema | 4bd | @bob | #schema | after:api-audit
  [ ] Data migration scripts | 3bd | @bob | #data-migrate | after:schema
  [ ] API compatibility layer | 3bd | @alice | #compat | after:schema
  [ ] Backend integration tests | 2bd | @alice | #be-tests | after:data-migrate,compat
  >> Backend Ready | #backend-ready | after:be-tests
end:

parallel: Frontend | after:kickoff
  [~] Component inventory | 2bd | @carol | #comp-inv
  [ ] New design tokens | 2bd | @dave | #tokens | after:comp-inv
  [ ] Migrate component library | 6bd | @carol | #comp-lib | after:tokens
  [ ] Update routing & navigation | 2bd | @dave | #routing | after:tokens
  [ ] Visual regression tests | 2bd | @carol | #vr-tests | after:comp-lib,routing
  >> Frontend Ready | #frontend-ready | after:vr-tests
end:

parallel: Infrastructure | after:kickoff
  [~] Provision new clusters | 3bd | @ops | #clusters
  [ ] Configure service mesh | 2bd | @ops | #mesh | after:clusters
  [ ] Setup observability stack | 2bd | @ops | #observe | after:clusters
  [ ] CDN & edge config | 1bd | @ops | #cdn | after:clusters
  [ ] Load & chaos testing | 3bd | @ops | #load-test | after:mesh,observe,cdn
  >> Infra Ready | #infra-ready | after:load-test
end:

[ ] Full integration testing | 4bd | @qa | #int-test | after:backend-ready,frontend-ready,infra-ready
[ ] Performance baseline | 2bd | @ops | #perf | after:int-test
[ ] Security audit | 3bd | @security | #sec-audit | after:int-test
[ ] Staged rollout — 10 % | 2bd | @ops | #rollout-10 | after:perf,sec-audit
[ ] Staged rollout — 50 % | 2bd | @ops | #rollout-50 | after:rollout-10
[ ] Full cutover | 1bd | @ops | #cutover | after:rollout-50
// Coordinate with support team for war-room coverage. Rollback window is 4 h.
>> Migration Complete | after:cutover
```
