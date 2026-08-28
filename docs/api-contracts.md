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
`x-recipe-lab-consumer-evidence`. Its 45 OpenAPI operations have exactly one of
four classifications:

| Classification | OpenAPI operations | Meaning |
| --- | ---: | --- |
| `active_consumer` | 32 | A current in-repository product workflow calls the operation. Its evidence identifies the maintained consumer boundary. |
| `staff_internal` | 8 | The operation supports a bounded curator, moderator, or operator workflow rather than an ordinary cook-facing workflow. Staff-only does not mean unreviewed or safe to remove. The four separately inventoried framework routes use this classification too. |
| `research_experimental` | 2 | The operation is limited to an explicitly identified research or experimental boundary. It is not evidence of a supported consumer product claim. |
| `retired` | 3 | No maintained in-repository product consumer remains. The operation is retained temporarily pending an external-consumer, deprecation, or removal decision, and new consumers must not depend on it. It may still return a functional response. |

These labels describe the present contract and its known in-repository use. They
do not authorize a behavior change. Reclassification is itself inventory drift
and must be reviewed with updated evidence.

Classification describes consumers, not implementation quality. In particular,
measurement conversion is `research_experimental` because the evidence audit
found no production frontend caller; its conversion rules remain reviewed and
tested. Likewise, `retired` applies only to the three identified legacy HTTP
adapters. It does not retire the still-used duplicate evidence/services, the
active saved-draft duplicate client, or the review and publication workflow
that consumes its results.

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

## Stable operation IDs and drift review

An OpenAPI `operationId` is a contract identifier for generated clients,
documentation, tests, and future shared transport work. Operation IDs must be
unique and stable across refactors. Renaming a Python function, moving a router,
or reorganizing a module must not silently rename the operation. An intentional
operation-ID change is reviewed as a consumer-facing contract change even when
the HTTP method, path, and schema remain the same.

The committed snapshot is a baseline, not compatibility analysis by itself.
Reviewers must still decide whether a diff is additive, breaking, incorrectly
classified, missing evidence, or an intentional retirement. Later generated
TypeScript types or clients must consume the stable operation IDs and the
reviewed OpenAPI schema; RCP-34A does not introduce those runtime consumers.
