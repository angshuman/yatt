# Enterprise Program

A full-scale program combining every YATT feature: parallel tracks, subtasks,
milestones, fixed dates, delays, OR-dependencies, external refs, priorities,
progress, and all status types.

```yatt
title: Core Banking Modernisation
owner: @program-director
start: 2026-04-01
schedule: business-days
week-start: mon

## Program Kickoff

[~] Steering committee sign-off | 1bd | @program-director | !critical | #sign-off
[ ] Program office setup | 2bd | @pmo | #pmo-setup | after:sign-off
[ ] Tooling & access provisioning | 2bd | @devops | #tooling | after:sign-off
>> Program Kickoff | #kickoff-ms | after:pmo-setup,tooling

## Stream A — Core Ledger

parallel: Core Ledger | after:kickoff-ms
  [~] Legacy system audit | 5bd | @alice | !high | %70 | #ledger-audit | $JIRA-1201
  [ ] Domain model design | 4bd | @alice | @bob | #ledger-model | after:ledger-audit
  .   Account entity | 1bd | @alice
  .   Transaction entity | 1bd | @bob
  .   Posting rules engine | 2bd | @alice
  [ ] Ledger service — core | 8bd | @alice | !high | %0 | #ledger-core | after:ledger-model
  .   Repository layer | 2bd | @alice
  .   Service layer | 3bd | @alice
  .   REST API | 2bd | @bob
  .   OpenAPI spec | 1bd | @bob
  [ ] Ledger service — events | 4bd | @bob | #ledger-events | after:ledger-core
  [ ] Contract tests | 3bd | @qa-a | #ledger-tests | after:ledger-events
  [o] Regulatory reporting adapter | 5bd | @alice | !high | #reg-adapter | +delayed:2w | after:ledger-tests
  >> Ledger Service Ready | #ledger-ready | after:ledger-tests
end:

## Stream B — Payments Engine

parallel: Payments Engine | after:kickoff-ms
  [ ] Payment scheme research | 3bd | @carol | #pay-research | $JIRA-1205
  [ ] Payments domain model | 3bd | @carol | #pay-model | after:pay-research
  [ ] SEPA credit transfer | 6bd | @carol | !critical | #sepa | after:pay-model
  .   Outbound flow | 3bd | @carol
  .   Inbound reconciliation | 2bd | @carol
  .   Exception handling | 1bd | @dave
  [ ] Faster Payments | 5bd | @dave | #fps | after:pay-model
  .   Submission | 2bd | @dave
  .   Confirmation & returns | 2bd | @dave
  .   Daily settlement | 1bd | @dave
  [!] SWIFT MT → MX migration | 8bd | @carol | !critical | #swift-mx | after:sepa,fps | blocked
  [ ] Payment gateway tests | 4bd | @qa-b | #pay-tests | after:swift-mx
  >> Payments Engine Ready | #payments-ready | after:pay-tests
end:

## Stream C — Customer Identity

parallel: Identity Platform | after:kickoff-ms
  [x] IdP evaluation | 3bd | @eve | #idp-eval
  [x] Architecture decision record | 1bd | @eve | #adr | after:idp-eval
  [~] SSO integration | 4bd | @eve | %40 | #sso | after:adr
  [~] MFA & step-up auth | 3bd | @frank | %20 | #mfa | after:adr
  [ ] Customer KYC service | 5bd | @eve | #kyc | after:sso,mfa
  .   Identity verification | 2bd | @eve
  .   Document upload & OCR | 2bd | @frank
  .   Sanctions screening | 1bd | @eve
  [_] Legacy LDAP bridge | 3bd | @frank | cancelled
  [ ] Identity platform tests | 3bd | @qa-c | #id-tests | after:kyc
  >> Identity Platform Ready | #identity-ready | after:id-tests
end:

## Integration & Hardening

[ ] Service mesh & API gateway | 4bd | @devops | #api-gw | after:ledger-ready|payments-ready|identity-ready
[ ] End-to-end integration tests | 6bd | @qa-lead | !critical | #e2e | after:api-gw
.   Happy-path scenarios | 2bd | @qa-a
.   Edge cases & rollbacks | 2bd | @qa-b
.   Performance benchmarks | 2bd | @qa-c
[ ] Security penetration test | 5bd | @security | #pentest | after:e2e | $VENDOR-SEC
[ ] Regulatory compliance review | 3bd | @compliance | !critical | #compliance | +fixed | >2026-09-01
[ ] Disaster recovery drill | 2bd | @devops | #dr-drill | after:e2e
>> System Integration Complete | #sys-ready | after:pentest,compliance,dr-drill

## UAT & Go-Live

[ ] User acceptance testing | 10bd | @uat-team | !high | #uat | after:sys-ready
[?] Parallel run — shadow mode | 5bd | @ops | !high | #shadow | after:uat | at-risk
[ ] Cutover planning | 3bd | @pmo | #cutover-plan | after:uat
[ ] Staff training | 4bd | @change-mgmt | #training | after:uat
[ ] Go-live cutover | 1bd | @devops | !critical | #go-live | after:shadow,cutover-plan,training
[ ] Hypercare — 30 days | 20bd | @ops | #hypercare | after:go-live
>> Programme Complete | after:hypercare
```
