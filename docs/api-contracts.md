# Backend API contract baseline

RCP-34A records the backend HTTP surface before later transport and workflow
refactors. The baseline is an inventory, not a redesign: outside intentional
OpenAPI metadata, it changes no ordinary endpoint path, request/response
application behavior, authorization rule, database query, migration, frontend
behavior, recommendation behavior, or product claim.

## Sources of truth

FastAPI remains the executable source of the HTTP contract. The repository also
commits its deterministic OpenAPI rendering at
[`backend/openapi.json`](../backend/openapi.json). The snapshot makes route,
schema, response, stable operation-ID, classification, and consumer-evidence
drift reviewable without starting a server or querying PostgreSQL.

FastAPI's four framework-owned documentation/schema routes are tracked as
`staff_internal` GET/HEAD surfaces even though the framework does not include
those routes as operations inside its own OpenAPI document. They are inventory
evidence, not ordinary product endpoints.

From `backend`, check the committed snapshot with:

```powershell
python -m app.openapi_contract check
```

Running `python -m app.openapi_contract` without a subcommand performs the same
check. CI runs the explicit `check` form in the separately named **Check backend
API contract drift** step so a stale contract is distinguishable from lint,
typing, migration, or test failures.

After an intentional, reviewed backend contract change, regenerate with:

```powershell
python -m app.openapi_contract write
python -m app.openapi_contract check
```

Review the `backend/openapi.json` diff as contract code. Do not regenerate merely
to make CI green: the route change, compatibility decision, classification, and
consumer evidence must be reviewed together. The write/check commands generate
the schema in process; they do not connect to the database or change runtime or
stored data.

## Operation classifications

The snapshot records these as `x-recipe-lab-classification` and
`x-recipe-lab-consumer-evidence`. Its 50 OpenAPI operations have exactly one of
four classifications:

| Classification | OpenAPI operations | Meaning |
| --- | ---: | --- |
| `active_consumer` | 40 | A current in-repository product workflow calls the operation. Its evidence identifies the maintained consumer boundary. |
| `staff_internal` | 8 | The operation supports a bounded curator, moderator, or operator workflow rather than an ordinary cook-facing workflow. Staff-only does not mean unreviewed or safe to remove. The four separately inventoried framework routes use this classification too. |
| `research_experimental` | 2 | The operation is limited to an explicitly identified research or experimental boundary. It is not evidence of a supported consumer product claim. |
| `retired` | 0 | No maintained in-repository product consumer remains. A deployed operation stays in this class until an external-consumer, deprecation, or removal decision is reviewed; new consumers must not depend on it. |

These labels describe the present contract and its known in-repository use. They
do not authorize a behavior change. Reclassification is itself inventory drift
and must be reviewed with updated evidence.

Classification describes consumers, not implementation quality. In particular,
measurement conversion is `research_experimental` because the evidence audit
found no production frontend caller; its conversion rules remain reviewed and
tested. Removing the former legacy HTTP adapters does not retire the still-used
duplicate evidence/services, the active saved-draft duplicate client, or the
review and publication workflow that consumes its results.

## Consumer evidence and the external boundary

Consumer evidence is a bounded repository reference that explains why the
classification is true, such as a maintained frontend API module, a staff
workflow, or a research boundary. Contract tests alone prove a response shape;
they do not prove that an operation has an active runtime consumer.

The external-consumer status is separate from the four classifications and is
recorded as `x-recipe-lab-external-consumer-status`, currently
`unknown_pending`. Repository searches cannot prove that a deployed API has no
callers outside this repository, and privacy-safe operations policy does not
retain raw paths or account activity to manufacture that proof. Until the status
is resolved by an explicit release/governance decision, no deployed operation
may be removed solely because its in-repository consumer evidence is empty. Use
a reviewed deprecation or compatibility response when removal cannot be proven
safe. Retired operations also name their active replacements through
`x-recipe-lab-successor-operation-ids`.

### RCP-34E pre-deployment removal decision

RCP-34E removed these three previously retired operations rather than retaining
temporary `410 Gone` responses:

- `POST /api/recipes/{recipe_version_id}/variants`;
- `POST /api/recipes/{recipe_version_id}/duplicate-preflights`; and
- `POST /api/recipe-duplicate-preflights/{preflight_id}/decision`.

This is a reviewed pre-deployment removal, not an inference from missing access
logs. The production-deployment story RCP-21 remains open and explicitly depends
on completion of the RCP-34 through RCP-36 prelaunch epics. A fresh repository
search found no maintained frontend, service-to-service, script, or end-to-end
caller, and RCP-34D had already removed the isolated frontend workflow. The
operations therefore never formed a deployed external contract, so a runtime
deprecation window or `410` compatibility shim would preserve dead behavior
without protecting a caller. The active replacements are private draft creation,
revisioned saving, draft-scoped duplicate preflight, and atomic draft publication.

This decision does not authorize removing the duplicate evidence tables,
decisions, fingerprints, scoring, publication receipts, lineage, migration
history, or fork events used by the active workflow. If deployment evidence ever
contradicts the pre-deployment premise, removal must stop and return to an
explicit compatibility decision.

## Stable operation IDs and drift review

An OpenAPI `operationId` is a contract identifier for generated clients,
documentation, tests, and future shared transport work. Operation IDs must be
unique and stable across refactors. Renaming a Python function, moving a router,
or reorganizing a module must not silently rename the operation. An intentional
operation-ID change is reviewed as a consumer-facing contract change even when
the HTTP method, path, and schema remain the same.

The committed snapshot is a baseline, not compatibility analysis by itself.
Reviewers must still decide whether a diff is additive, breaking, incorrectly
classified, missing evidence, or an intentional retirement.

## Frontend generated types

RCP-34G generates one committed TypeScript file at
[`frontend/lib/api-contracts/generated.ts`](../frontend/lib/api-contracts/generated.ts)
from `backend/openapi.json`. The file contains compile-time request, response,
and operation types. It is not a second HTTP client and does not replace runtime
validation.

From `frontend`, regenerate and check it with:

```powershell
npm run api:contracts:generate
npm run api:contracts:check
```

CI runs the check and fails when the OpenAPI snapshot and generated TypeScript
file differ. When a backend contract changes intentionally, regenerate the file
and review both diffs together. Intentional breaking changes must be called out
in the pull request or release note. Automated comparison between released API
versions is deferred until Recipe Lab has an independently released API or an
external client to protect.

The recipe-report client is the first consumer. Its ordinary request and
response types now come from OpenAPI, while its private receipt parser still
rejects unexpected response fields. Other clients move when their own story
changes them; they do not block this foundation.

Generated types do not own requests. The shared Recipe Lab transport remains
responsible for same-origin routing, sessions, CSRF, idempotency, request
fingerprints, cancellation, and recovery behavior.

## Shared browser mutation headers

Browser callers give the shared transport a mutation identity containing an
opaque idempotency key and a lowercase SHA-256 request fingerprint. The
transport validates both, overwrites any caller-supplied `Idempotency-Key` with
the identity value, and obtains `X-CSRF-Token` from the current member session.
The browser supplies the same-origin session cookie through normal credential
handling; callers never copy a cookie into request options. JSON consumers add
`Content-Type: application/json`, while the transport supplies
`Accept: application/json` unless the caller already set it.

The request fingerprint is client-side attempt identity, not a trusted request
header. Feature endpoints that persist replay evidence, including private draft
creation, recompute their versioned canonical fingerprint on the server. This
keeps equality and conflict decisions under server control while the shared
transport owns the transmitted `Idempotency-Key`, CSRF header, same-origin
route, no-store behavior, deadline, and redirect rejection.
