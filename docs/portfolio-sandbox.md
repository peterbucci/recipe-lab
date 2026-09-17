# Public interactive portfolio sandbox

Recipe Lab's portfolio deployment is a public demonstration focused on U.S.
employers. People elsewhere may access it. Visitors receive separate temporary
identities and can exercise the ordinary recipe and social workflows using
demonstration content. This is a bounded product-scope decision, not a statement
that privacy law does not apply. RCP-54 remains deferred for this sandbox and
required before a persistent public community or exceptional published-content
erasure service is offered.

## Ownership and lifetime

Authentication owns visitor sessions and CSRF protection. Existing domains still
own drafts, publication, lineage, moderation, interactions, and account deletion.
Published recipe snapshots remain immutable. Account deletion and seed loading
do not erase published visitor content and must never be advertised as a reset.

One environment generation lasts at most 24 hours. Its UUID and exact start/end
timestamps are configured once, then bound into `sandbox_generations` before
seeding. Initialization refuses an existing account database. Database triggers
reject changing, deleting, or truncating the binding. Restarting the app with a
new UUID or extended deadline fails admission. A schema downgrade refuses to
remove a populated binding; replace the whole environment instead. Restoring an old database under
new sandbox settings also fails. Reserved `recipe_lab_sandbox_` database names
require sandbox mode. Disabling the mode, renaming the database, or retargeting
a bound database into the persistent profile is unsupported; the supervisor
never renames a database. These controls do not claim to resist deliberate
database-administrator bypasses. Every content API and readiness check verifies the
binding and deadline; liveness stays available. Sessions cannot outlive the
generation. At expiry the whole database is discarded and replaced from clean
migrations and reviewed seeds; old cookies no longer identify any account in
the replacement. There is no public reset endpoint or recipe deletion bypass.

No user uploads, advertising, session replay, or third-party analytics are
introduced. Passive recipe-view events are not recorded in sandbox mode;
intentional save, rating, and fork operations keep their existing transactional
records. Research recommendations are disabled in sandbox mode. The offline
research exporter refuses databases carrying a generation binding, even after
the database is renamed. Visitors should never enter private or sensitive
information. Display the configured HTTPS contact page alongside demo entry so
an operator can take the entire sandbox offline or replace it early when needed.

## Concrete isolated supervisor

Run `python -m scripts.run_portfolio_sandbox` from the repository root with:

```text
--backend-image sha256:<verified-backend-image-id>
--frontend-image sha256:<verified-frontend-image-id>
--origin https://<portfolio-demo-origin>
--contact-url https://<owner-contact-page>
--port 3100
```

This command requires existing production images verified by the repository's
image/release checks. It builds or publishes nothing. The frontend listener binds
only `127.0.0.1`, for a separately configured HTTPS reverse proxy. The development
Compose database, its volume, and ports 3000/8000 are never targeted.

The command runs successive isolated generations. Each uses an exact UUID-based
network/container name and ownership label, an internal Docker network, fresh
random service secrets, a private PostgreSQL endpoint, and no Docker log store.
Only the frontend additionally joins a generation-owned ingress bridge, because
Docker does not publish ports from an internal-only network. Its published port
remains loopback-only; backend and database have no public port or ingress-network
attachment. The frontend bridge permits ordinary outbound connections; a hosting
requirement to restrict those further belongs to #21's reviewed platform policy.
PostgreSQL data and WAL live together in a size-bounded tmpfs; no data volume,
backup, replication stream, archive, or dump is created. Containers have memory,
swap, CPU, and process limits. The database runs its own absolute-deadline guard,
so it terminates and Docker removes its tmpfs even if the host supervisor stops
running. The API deadline remains an independent access control.

Initialization is fail-closed: create empty storage, migrate, bind the generation,
seed, verify the binding, and pass backend readiness before starting the frontend
listener. At replacement, stop the frontend listener first, then backend writers,
then remove the whole database. Each destructive operation independently checks
the exact name and ownership label, including both networks. If cleanup fails,
the supervisor stops; it does not open a new generation. Restarting requires
inspecting the dedicated resources. Raw database or HTTP logs are never retained
for diagnosis.

Use `--once` to run one generation and stop. `--lifetime-seconds` permits 60–86400
seconds for isolated rehearsal; a very short window can expire during startup
and correctly fail to become ready. The default is 24 hours. Interrupting the
supervisor closes and removes its current generation. Early replacement means
stopping that supervisor and starting a fresh one, never changing its deadline.

## Repeatable local reset rehearsal

With Docker running, the repository's backend Python dependencies installed, and
the exact production images already verified, run from the repository root:

```text
python -m scripts.rehearse_portfolio_sandbox --backend-image sha256:<verified-backend-image-id> --frontend-image sha256:<verified-frontend-image-id>
```

Leave loopback ports 3100 and 3443 free. The rehearsal creates a temporary HTTPS
proxy and certificate trusted only by its test client; it changes no machine-wide
certificate trust or public routing. Its two independent visitors use Secure
session cookies through the real frontend API proxy, including real publication,
private drafts, profiles, saves, ratings, follows, reports and ingredient requests.

The first generation expires after 240 seconds by default. The database must
remove itself without the supervisor's main loop; content/readiness must fail
closed while liveness still works. A clean second generation must match the
reviewed seed identities and table counts, reject an explicitly replayed old
cookie, lack the old content, and allow fresh demo entry and rendered browsing.
The command also verifies container storage/network settings and rejection of
changed generation identity or extended expiry. `--lifetime-seconds` accepts
120–900 seconds for slower or faster local runs.

Only identifier-free pass/fail results are printed. Synthetic visitor content and
cookies remain in memory; no browser trace, database dump, raw response, or
request log is saved. Cleanup verifies exact resource ownership, removes the
test generations and temporary TLS files, and does not target development
services. This is a local transport/reset test, not a browser accessibility test,
public-host certification, or a claim that host swap/snapshots are disabled.
Deliberate process/cleanup interruption checks and the actual hosting controls
below remain separate verification responsibilities.

## Storage and deployment evidence still required by #21

The command enforces container behavior; it cannot attest to the hosting platform.
Before public routing, verify these actual platform properties:

- tmpfs pages cannot spill into unencrypted host swap; host/VM snapshots, database
  backups, replication, crash dumps, debug exports, and raw access logs are off;
- no reverse proxy, CDN, browser service worker, APM, or provider cache retains
  HTML/API bodies beyond the generation; existing API paths use `no-store`;
- the supervised process restarts appropriately, external probes alert when
  readiness fails, and failure leaves traffic closed instead of serving an old
  database; never configure a database-container restart policy;
- the real HTTPS proxy preserves trusted network hints, cookies, CSRF/origin
  behavior, and the existing privacy-safe event and aggregate limits;
- a two-generation rehearsal proves old session tokens, private drafts, published
  recipes, profile handles, interactions, reports, and ingredient requests are
  unavailable, while reviewed seed data and fresh visitor access work;
- deadline expiry and a deliberately interrupted replacement both stop content
  access; a restored old database cannot acquire a fresh lifetime in the supported
  sandbox deployment. Only images enforcing the generation contract are eligible
  for sandbox rollback; a persistent-profile ancestor image is not compatible.

Previously delivered content may remain in a visitor's open page or their own
copy; server-side expiry cannot recall it. The demo notice promises temporary
server retention, not erasure of copies outside the operator's control.

For this disposable profile, backups are prohibited rather than retained for the
ordinary deployment's maximum 30 days. Recover by creating a clean generation.
RCP-33G's account-deletion-ledger recovery proof remains valid for the separate
persistent deployment profile; do not restore visitor sandbox backups or present
ordinary account deletion as exceptional erasure. Keep only identifier-free
pass/fail operational evidence. No real visitor artifacts belong in CI.

Public deployment, provider account configuration, domain/TLS setup, registry
publication, platform certification, and final release approval remain #21 work.
Repository tests or a local supervisor alone do not prove those external controls.

The [implementation evidence record](baselines/2026-09-16-portfolio-sandbox-implementation.md)
separates completed local checks from outstanding container and deployment
certification. Do not treat implemented controls as proof that a particular
public host meets the retention requirements.

The frontend currently derives network limits from its direct peer and rejects
untrusted forwarding headers. A loopback reverse proxy therefore groups traffic
under that proxy's network bucket. Treat this as a conservative shared limit;
do not silently trust `X-Forwarded-For` to obtain per-visitor limits. Any real
platform network-identity integration must preserve the existing trusted-signal
boundary and be verified in #21. The read-only frontend container deliberately
has no writable persistent Next.js cache; the supervisor checks both frontend
liveness and a rendered public recipe browse inside the container and through
the published loopback listener before declaring it ready.
