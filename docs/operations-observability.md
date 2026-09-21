# Privacy-safe operations and observability

RCP-33F defines the operational contract Recipe Lab must satisfy before a
deployment can receive public traffic. It adds signals for service and database
health without turning logs or metrics into a second account-history store.
This document is the operator runbook and sink policy; it does not deploy or
configure a hosted monitoring vendor.

## Liveness is not readiness

The backend exposes two deliberately different probes:

| Probe | Success | Failure meaning | Traffic decision |
| --- | --- | --- | --- |
| `GET /api/health` | `200 {"status":"ok","service":"recipe-lab-api"}` | The API process cannot answer. | Restart or replace the process. |
| `GET /api/readiness` | `200 {"status":"ready","service":"recipe-lab-api"}` | Fixed `503 dependency_unavailable` error response. | Remove the instance from service; do not route user traffic to it. |
| `GET /healthz` on the frontend | Uncached `200 ok` plain text. | The Next.js process cannot answer. | Restart or replace the process. |

`/api/health` never queries PostgreSQL. A running API with an unavailable
database therefore remains live but is not ready. A load balancer must use
`/api/readiness`, not `/api/health`, as its traffic-admission check. The
readiness responses have fixed shapes, reveal no connection string, host,
database name, exception text, query, or migration detail, and fail closed
when the dependency check cannot complete.

Application database waits share the bounded
`DATABASE_OPERATION_TIMEOUT_SECONDS` setting (default **5**, accepted range
**1–30 seconds**). It limits connection-pool checkout, PostgreSQL connection
establishment, statement execution, and stalled TCP delivery; short TCP
keepalives use the same bound. This prevents a stalled readiness probe or API
database operation from occupying a worker thread indefinitely. Migration and
test-created engines retain their separate, explicit configuration.

The unavailable body is the normal API error envelope:

```json
{
  "error": {
    "code": "dependency_unavailable",
    "message": "A required service dependency is temporarily unavailable.",
    "issues": [],
    "correlation_id": "00000000-0000-4000-8000-000000000000"
  }
}
```

The example UUID illustrates the shape only; every real response receives a
fresh random UUIDv4, and its header and body values must match.

The production-image verifier creates a disposable PostgreSQL container,
applies the current migration head, and proves the live and ready states. It
then stops PostgreSQL and requires liveness to remain `200` while readiness
becomes the fixed `503` unavailable response. A timeout, unexpected payload,
or successful readiness response after the dependency stops fails the gate.

## Correlation-ID contract

Every backend HTTP response has an `X-Correlation-ID` header containing a fresh
canonical lowercase UUIDv4. Safe frontend-proxy errors use the same contract.
Error bodies that include `error.correlation_id` must match the response
header. Incoming browser correlation headers are discarded: clients cannot
choose log values or smuggle account or request data into the sink.

The ID is random per request. It never encodes a user, session, IP address,
recipe, path, query, deployment, or error detail. It is not authentication and
must not be used as a durable member or device identifier. A support response
may ask a user for the correlation ID shown with an error, but must not ask for
cookies, tokens, callback URLs, request bodies, or private recipe text.

## Exact structured-event allowlist

The backend `recipe_lab.operations` logger may emit only these event names:

- `authentication_failure`
- `publication_failure`
- `database_failure`
- `application_failure`

Their complete payload is `event` plus `correlation_id`. The frontend server
may emit only:

- `recipe_lab.frontend.authentication_failed`
- `recipe_lab.frontend.recipe_api_unavailable`

Their complete payload is `event`, `correlation_id`, and numeric `status_code`.
The proxy discards forged inbound correlation IDs and never logs a caught error
object. Adding an event name or field is a governance change that must update
the account-data manifest and its drift test before it reaches a sink.

Raw HTTP access logs and unrestricted exception telemetry remain prohibited.
No sink may receive a raw path, route parameter, query string, request or
response body, header, cookie, token, authorization code, IP address, account-
derived identifier, handle, email address, private free text, stack trace,
exception message, or caller-supplied label. Sampling does not make a forbidden
field safe.

Structured request events expire automatically after at most **7 days**.
Access is restricted to the operators responding to incidents, and exports are
disabled. The retention window is a maximum, not a minimum.

## De-identified aggregate signals

A deployment may derive only fixed-name, low-cardinality counts, rates, and
bucketed latency from the allowlisted event boundary. Request-level correlation
IDs are excluded from aggregate metrics. Permitted labels are limited to fixed
operation, outcome, status-code class, dependency, latency bucket, and reviewed
deployment revision values. Raw paths and user-controlled labels are never
dimensions.

The minimum operator dashboard contains:

| Signal | Calculation and first response |
| --- | --- |
| Authentication failure rate | Failed authentication outcomes divided by all fixed authentication outcomes over 5 minutes. Investigate when at least 20 attempts exist and the rate exceeds 15%; compare the backend and frontend fixed events and check provider availability without logging provider responses. |
| Publication failure rate | Failed publication outcomes divided by all fixed publication outcomes over 5 minutes. Investigate when at least 10 attempts exist and the rate exceeds 5%; check database readiness and the deployment revision before examining any user report. |
| Database failure rate | `database_failure` events and unavailable readiness checks over 1 minute. Two consecutive unavailable checks page the operator and remove the instance from traffic. |
| Dependency availability | Percentage of `/api/readiness` checks that return the fixed ready `200` response. Any `503 dependency_unavailable` instance is excluded from traffic; a fleet-wide failure blocks rollout or triggers rollback review. |
| Application failure rate | Fixed application failures divided by bounded total request outcomes over 5 minutes. Investigate above 2% with at least 50 outcomes. |
| Latency | Reviewed duration buckets by fixed operation and outcome only. Never attach request, account, recipe, or correlation identifiers. |

These thresholds are conservative initial operating defaults, not proof of a
service-level objective. Tune them only from de-identified aggregate evidence
and record the reviewed change. Aggregate metrics expire automatically after at
most **30 days** and must use a minimum cohort where a breakdown could isolate
one member.

## Smoke test and rollback procedure

Before shifting traffic to a candidate revision, an operator must:

1. Apply migrations as a separate, successful deployment step.
2. Call `/api/health` and require the fixed `200` body plus a valid fresh
   `X-Correlation-ID`.
3. Call `/api/readiness` and require the fixed ready `200` body plus a
   different valid correlation ID.
4. Exercise one safe synthetic error and verify that its response header and
   body correlation IDs match while its structured event contains only the
   allowlisted fields. Never use a real member or private recipe as the canary.
5. Confirm the authentication, publication, database, dependency, application,
   and latency panels are receiving only the reviewed fields.

The production-image gate also performs the isolated database-outage proof. Do
not stop or impair a shared production database to repeat that test.

If readiness, correlation, redaction, or signal checks fail, send no new
traffic to the candidate. Keep the last known-good revision serving, preserve
only the allowlisted short-lived events, and record the candidate revision and
fixed failure category. Roll back the application image only when the applied
schema is explicitly compatible with that image. Never run an automatic
Alembic downgrade against production. If a migration or data invariant prevents
a safe image rollback, stop the rollout and use the reviewed restore and
deletion-replay procedure in
[account-data governance](account-data-governance.md).

After rollback, require liveness, readiness, correlation, redaction, and the
aggregate panels to recover before resuming traffic. A correlation ID may join
the response to its short-lived structured event; it is not authority to retain
any surrounding raw request or user data.

The isolated RCP-33G rehearsal exercises the safe image-only form of this
procedure: it records the restored database revision, stops the candidate,
starts the exact prior image IDs against that unchanged newer schema, repeats
the smoke checks, and requires the database revision to remain unchanged. A
prior image may package an older migration head. It never uses an Alembic
downgrade as an application rollback. See
[release, recovery, and rollback rehearsal](release-rehearsal.md).

## Deployment review checklist

Before connecting any logging, tracing, analytics, crash-reporting, APM, CDN,
or load-balancer sink, review and test all of the following:

- access logging and raw traces are disabled;
- an exact event-name, field-name, and label-value allowlist is enforced before
  emission, including the two frontend proxy events;
- redaction happens before buffering, transport, retry, dead-letter, or vendor
  ingestion;
- event retention is no more than 7 days and aggregate retention no more than
  30 days, including backups and vendor-side copies;
- exports, unrestricted search, cross-product identity joins, session replay,
  and ad-hoc fields are disabled;
- operators can delete a sink and its replicas at the retention boundary; and
- a canary containing a synthetic secret is rejected before emission and never
  appears in console output, CI artifacts, dashboards, alerts, or vendor data.

If a platform cannot enforce this contract, that sink is not approved for
Recipe Lab deployment.
