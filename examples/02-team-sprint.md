# Team Sprint

Sprint planning with statuses, assignees, priorities, progress, and dependencies.

```yatt
title: Sprint 12 — Auth & Dashboard
owner: @sarah
start: 2026-03-30
schedule: business-days

## Backend

[x] Setup CI pipeline | 1bd | @bob | !critical | #ci
[~] User authentication API | 3bd | @alice | !high | %60 | #auth-api | after:ci
[~] Database schema migration | 2bd | @bob | %80 | #db-migrate | after:ci
[ ] Session management | 2bd | @alice | #session | after:auth-api
[ ] API rate limiting | 2bd | @bob | #rate-limit | after:db-migrate

## Frontend

[~] Login page | 2bd | @carol | %50 | #login-pg
[ ] Dashboard layout | 3bd | @carol | #dashboard | after:login-pg
[ ] Data visualisations | 4bd | @dave | #dataviz | after:login-pg
[?] Mobile responsive fixes | 3bd | @dave | !high | #mobile

## QA

[ ] Auth flow testing | 2bd | @qa | #qa-auth | after:auth-api,login-pg
[ ] Dashboard testing | 2bd | @qa | #qa-dash | after:dashboard,dataviz

>> Sprint Demo | after:qa-auth,qa-dash
```
