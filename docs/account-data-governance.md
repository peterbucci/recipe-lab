# Account-data governance and deletion completeness

RCP-33E turns account deletion from a hand-maintained list of tables into a
reviewed data contract. The authoritative manifest is
`backend/app/privacy/account_data_manifest.py`. It classifies every column and
every account-linked foreign-key path known to the SQLAlchemy model as one of:

- **delete**: remove the row or field when the member deletes the account;
- **anonymize**: retain only a fixed, non-identifying value required by a
  surviving record;
- **retain**: keep the minimum public topology or governance evidence, with a
  stated reason; or
- **prohibit**: do not create this kind of account-bearing artifact.

`backend/tests/test_account_data_manifest.py` independently walks the database
metadata outward from `users.id`. It compares the complete discovered table
set, every relationship between account-linked tables, and every column with
the reviewed manifest. Adding a new user foreign key, an indirect child table,
a relationship, or a field without an explicit decision fails the test. The
manifest is evidence and a review gate; it never generates deletion SQL.

## Database decisions

The field-level manifest is the exact source of truth. These row-level rules
explain why its individual decisions differ:

| Data family | Deletion rule | Retained reason |
| --- | --- | --- |
| Member identity, OIDC mappings, login transactions bound to a session, and sessions | Delete private identity and every session. Replace the user with the fixed `Deleted cook` tombstone. | The stable tombstone UUID alone preserves public authorship and audit foreign keys. |
| Curator and moderator roles | Delete roles held by the member immediately. | A tombstoned `granted_by_user_id` may remain on somebody else's role grant as operator-audit attribution. It does not authorize the deleted member. |
| Active drafts and structured draft children | Delete. | None. Drafts are private workspaces. |
| Published draft receipts | Delete every content child and anonymize title, description, and servings on the required shell. | Receipt keys, revision, timestamps, author tombstone, and source version prevent duplicate publication and preserve replay evidence. |
| Saves, ratings, and preference events | Delete. | None. These are private recommendation/activity signals. |
| Public recipe lineages, immutable versions, structured ingredients/actions, fingerprints, publications, and visibility events | Retain. | Public content, fork topology, duplicate evidence, and withdrawal/moderation history must remain internally consistent. Attribution resolves only to `Deleted cook`; it never reassigns content to Demo Cook. |
| Pending ingredient requests and their audit events | Delete. | Unreviewed member text never becomes catalog identity or governance evidence. |
| Reviewed ingredient requests | Anonymize free-form request context and its submitted-event context; retain the reviewed proposal and terminal decision. | The catalog needs provenance, duplicate resolution, and curator-decision evidence. Actor IDs resolve only to tombstones when those members delete. |
| Unbound similarity preflights, candidates, and decisions | Delete. | They are abandoned private workflow evidence. |
| Publication-bound similarity evidence | Retain. | It proves the advisory review and explicit publication decision for an immutable public snapshot. |
| Reports | Anonymize report details and the request fingerprint; retain reason, target, time, and reporter tombstone. | Aggregate case counts and abuse-review integrity require one durable report record without its private prose or replay identity. |
| Moderator actions | Anonymize the deleting moderator's private note and request fingerprint; retain the decision, before/after state, time, target, and actor tombstone. | Public-visibility and moderation audit history must remain explainable without retaining private free text from a deleted account. |
| Durable abuse buckets | Delete account-bound rows immediately. Pseudonymous identity/network rows survive only to their fixed `expires_at` and are removed in bounded batches by later limited traffic. | A short-lived HMAC digest prevents immediate rate-limit bypass without storing the raw identity or network. |

Deletion runs in one database transaction after locking the account lifecycle,
all bound identities, and every session in a stable order. The server—not just
the page—requires the exact current handle, or `DELETE` before onboarding, in
the request body. Provider-backed recent authentication, exact Origin and CSRF
evidence, typed confirmation, and active-member status are all required before
the tombstone is written. All sessions and held roles disappear in that same
transaction, so a successful response cannot leave usable authority behind.

## Files, logs, backups, and derived artifacts

Non-database data is governed even when it has no SQL foreign key:

| Artifact | Decision and boundary |
| --- | --- |
| External OIDC provider account | **Retain outside Recipe Lab.** Local issuer/subject mappings are deleted, but the provider's own credentials, recovery factors, and account lifecycle remain with that provider. Recipe Lab must not claim to delete an external identity it does not control. |
| Production HTTP access logs | **Prohibit.** The production Uvicorn server disables access logging so paths, cook handles, search text, and query strings are not persisted. A CDN, load balancer, reverse proxy, or APM service must enforce the same rule before deployment. |
| Application and error logs | **Prohibit** raw request/response bodies, cookies, authorization headers, OIDC values, account UUIDs, handles, email, private text, and query strings. **Retain** only separately allowlisted fixed event names and de-identified aggregate service metrics under a bounded operational window. |
| Database replicas, WAL, and dead storage pages | **Retain, then age out.** Restrict access and bound replication, WAL, checkpoint, and vacuum retention. Never expose or restore an older physical image without replaying completed account deletions first. |
| Database backups | **Retain, then delete.** Production deployment must use encrypted, access-controlled backups with a configured maximum retention of 30 days and automatic expiry. They are never product-browsable. Live deletion does not rewrite immutable historical backup blocks. |
| Restored databases | **Anonymize/delete before use.** Restore into an isolated network, apply current migrations, and replay every account deletion newer than the backup before health checks or traffic. A deployment without an external durable deletion ledger may not restore a point older than its latest deletion. Destroy failed or superseded restore copies. |
| Observed-member ML snapshots and derived reports | **Prohibit** in application-managed or production environments until an artifact registry can bind every included profile to deletion and expiry. The current offline CLI accepts an intentionally selected database only for disposable local research; those ignored files must be deleted after the run. |
| Synthetic ML fixtures and deterministic synthetic reports | **Retain.** They contain no production member identity and remain engineering-contract evidence, not claims about real people. |
| Browser traces, screenshots, videos, manifests, server logs, and database dumps | **Prohibit** for real accounts. Guarded acceptance uses isolated synthetic identities, privacy-scans retained summaries, and destroys all raw artifacts after the run. |
| User uploads | **Prohibit.** Recipe Lab has no upload store. A future upload feature must add storage-object ownership, deletion, backup, and derived-thumbnail policies before accepting files. |
| Source archives and container images | **Prohibit** account data and secrets. The safe-source and production-image gates enforce this boundary. |

Thirty days is a maximum backup lifetime, not a promise to keep every backup
that long. Operators should choose the shortest recovery window that meets the
service objective. Changing that maximum, introducing a new log sink, enabling
observed-member exports, or adding any durable storage is a governance change
that must update the manifest and its tests before deployment.

## Restore and incident checklist

Before a restored copy can serve traffic, an operator must:

1. keep it isolated and inaccessible to the web application;
2. apply the current migration head;
3. replay post-backup account deletions and verify complete tombstones;
4. verify that no session, OIDC identity, held role, private draft, interaction,
   private report text, moderator note, or unbound workflow evidence survived;
5. run the account-data metadata gate and the community release verifier; and
6. destroy the replaced database and temporary dump under the same retention
   boundary.

If the deletion ledger or verification evidence is unavailable, the restore
must fail closed. Restoring service quickly is not authority to resurrect a
deleted account.

## Review rule for future schema work

Every migration that adds a table, column, foreign key, file store, log sink,
backup path, cache, analytics export, or derived model artifact must answer:

1. How is it linked directly or indirectly to a member?
2. Is it deleted, anonymized, retained, or prohibited, and why?
3. What code performs the decision and what test proves it?
4. How do replicas, backups, exports, and restore copies reach the same state?
5. Does the retained shape omit unnecessary identifiers and private free text?

The change is incomplete until the static manifest and independent metadata
test agree. A passing migration alone is not deletion evidence.
