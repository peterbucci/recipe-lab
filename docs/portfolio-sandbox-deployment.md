# Portfolio sandbox deployment

This runbook deploys Recipe Lab as a disposable demonstration on the existing EC2 host. Coolify's Traefik proxy owns DNS-facing HTTPS. A systemd service owns the sandbox supervisor, which creates a fresh frontend, backend, and tmpfs PostgreSQL generation and destroys it no later than 24 hours later.

This is not the persistent-production profile. It has no database volume, database backup, OIDC login, or restore path. Never deploy `compose.yaml` for this purpose.

## Fixed boundaries

- Deploy only a reviewed commit on the repository's default branch.
- Deploy backend and frontend images by GHCR manifest digest, never by tag.
- Run the matching supervisor source from the same commit as the images.
- Publish only the frontend listener on host port `3100`. Keep that port closed in the EC2 security group and host firewall.
- Bind port `3100` to the private Docker host-gateway address used by the Coolify proxy, not `0.0.0.0` or the EC2 public address.
- Trust forwarded client addresses only when both controls match: the direct peer is in a narrowly audited Coolify proxy-network CIDR and Traefik overwrote the private proxy-proof header with the on-host secret. Never use `0.0.0.0/0` or `::/0`.
- Keep PostgreSQL on tmpfs, application containers without logs, and proxy access logs/traces disabled for this router.
- Admit traffic only while the frontend can see a fresh, read-only supervisor heartbeat. The readiness endpoint coalesces concurrent callers and caches its bounded backend check for one second, so public probes cannot fan out one-for-one into database work.
- Treat a supervisor `fail-stop` marker or exit status `78` as a manual incident. Do not automatically clear it.

## 1. Publish a reviewed release

Protect the GitHub environment named `portfolio-sandbox-release` with the repository's release reviewer before the first run. The workflow's publish job has only `packages: write`; source selection and verification run separately with only `contents: read`.

From **Actions → Publish portfolio sandbox images → Run workflow**, enter:

- `release_ref`: the exact tag or commit being released;
- `expected_commit`: the full, lowercase 40-character commit SHA; and
- `confirm_publish`: checked.

The workflow verifies that both inputs resolve to the same commit, that the commit is on the default branch, and that exact SHA has successful `CI` and `Release rehearsal` workflow runs. It then builds the production targets, runs their production-image gate, scans the exact verified images for HIGH/CRITICAL vulnerabilities and secrets, and publishes these convenience tags:

```text
ghcr.io/peterbucci/recipe-lab-backend:sha-<40-character-commit>
ghcr.io/peterbucci/recipe-lab-frontend:sha-<40-character-commit>
```

The workflow never replaces a commit tag with different content. A retry safely accepts an already-published role only when its pulled image ID matches the sealed verified report, so a backend-only partial publication can be resumed. After publication it removes the local candidates, pulls both digest-qualified references back from GHCR, verifies their image IDs, and scans those exact registry digests again. Tags are discovery aids only.

Download the 90-day `portfolio-sandbox-release-<commit>` artifact and retain its `release-evidence.json` with the deployment record. That sanitized file records the required CI/rehearsal run IDs and binds the source commit and verified local image IDs to two immutable references of this form:

```text
ghcr.io/peterbucci/recipe-lab-backend@sha256:<manifest-digest>
ghcr.io/peterbucci/recipe-lab-frontend@sha256:<manifest-digest>
```

Do not reconstruct a digest from the tag or copy an image ID into the registry-digest position. They identify different objects.

### GHCR visibility

Choose the package-read policy explicitly:

- **Public packages:** preferred for a public portfolio. EC2 can pull the two digest-qualified references anonymously.
- **Private packages:** use a dedicated GitHub credential with only `read:packages` and repository read access if the package inherits private repository permissions. Supply it through `docker login --password-stdin`, use a temporary Docker configuration directory, pull, log out, and remove that directory. Do not place the credential in this repository, `/etc/recipe-lab/sandbox.env`, a command argument, or shell history.

The workflow token publishes packages but does not become a host credential.

## 2. Prepare the EC2 host

Record these preflight results in the certification evidence before installing anything:

```bash
swapon --show
df -h /
free -h
sudo systemctl is-active docker
sudo docker info --format '{{json .LoggingDriver}}'
```

Required results:

- no active swap;
- enough memory for the sandbox's three 768 MiB container ceilings plus MAGE and the host;
- enough disk for two application images and Docker's temporary pull data;
- no EC2, AWS Backup, Data Lifecycle Manager, or host job that captures sandbox visitor state;
- no host core-dump collection for the service; and
- no public security-group or firewall rule for TCP `3100`.

The database files and WAL remain in a size-bounded tmpfs. EBS snapshots do not capture RAM, but do not assert certification until the actual backup/snapshot policies and Docker storage behavior have been inspected. MAGE's own persistent backup plan is separate.

Create a dedicated service account. Membership in the `docker` group is privileged, so this account must have no interactive login or unrelated workload:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin recipe-lab-sandbox
sudo usermod --append --groups docker recipe-lab-sandbox
sudo install -d -o root -g root -m 0755 /opt/recipe-lab/releases
sudo install -d -o root -g recipe-lab-sandbox -m 0750 /etc/recipe-lab
```

Create a verifiable detached checkout for the exact release commit, refuse a preexisting destination, and then switch `current` with one rename:

```bash
release_commit=<40-character-commit-from-release-evidence>
release_stage="$(mktemp -d)"
git clone --filter=blob:none --no-checkout https://github.com/peterbucci/recipe-lab.git "$release_stage/source"
git -C "$release_stage/source" fetch --no-tags origin "$release_commit"
test "$(git -C "$release_stage/source" rev-parse --verify 'FETCH_HEAD^{commit}')" = "$release_commit"
git -C "$release_stage/source" checkout --detach "$release_commit"
test "$(git -C "$release_stage/source" rev-parse --verify 'HEAD^{commit}')" = "$release_commit"
test ! -e "/opt/recipe-lab/releases/$release_commit"
sudo mv "$release_stage/source" "/opt/recipe-lab/releases/$release_commit"
sudo chown -R root:root "/opt/recipe-lab/releases/$release_commit"
sudo chmod -R u=rwX,go=rX "/opt/recipe-lab/releases/$release_commit"
sudo git -C "/opt/recipe-lab/releases/$release_commit" diff --quiet
test "$(sudo git -C "/opt/recipe-lab/releases/$release_commit" rev-parse --verify 'HEAD^{commit}')" = "$release_commit"
sudo ln -s "/opt/recipe-lab/releases/$release_commit" "/opt/recipe-lab/.current-$release_commit"
sudo mv -T "/opt/recipe-lab/.current-$release_commit" /opt/recipe-lab/current
rmdir "$release_stage"
```

If `current` exists and is not a symlink, stop and inspect it instead of replacing it. For a later release, give the temporary symlink a new unique name and use the same final rename only after the new checkout and images pass rehearsal.

## 3. Pull immutable images and map runtime IDs

Copy each complete `reference`, `registry_digest`, and `local_image_id` value from `release-evidence.json`; do not type or shorten the digests:

```bash
backend_ref='ghcr.io/peterbucci/recipe-lab-backend@sha256:<backend-manifest-digest>'
frontend_ref='ghcr.io/peterbucci/recipe-lab-frontend@sha256:<frontend-manifest-digest>'
backend_registry_digest='sha256:<backend-manifest-digest>'
frontend_registry_digest='sha256:<frontend-manifest-digest>'
backend_config_id='sha256:<backend-local-image-id>'
frontend_config_id='sha256:<frontend-local-image-id>'
sudo docker pull "$backend_ref"
sudo docker pull "$frontend_ref"

resolve_runtime_id() {
  local reference="$1" expected_registry_digest="$2" expected_config_id="$3"
  local runtime_id manifest_config_id
  [ "${reference##*@}" = "$expected_registry_digest" ] || return 1
  runtime_id="$(sudo docker image inspect --format '{{.Id}}' "$reference")" || return 1
  if [ "$runtime_id" = "$expected_config_id" ]; then
    : # Docker's classic image store addresses the platform config directly.
  elif [ "$runtime_id" = "$expected_registry_digest" ]; then
    # Docker's containerd image store addresses this single-platform image by manifest.
    manifest_config_id="$(
      sudo docker buildx imagetools inspect --raw "$reference" |
        python3 -c 'import json, sys; print(json.load(sys.stdin)["config"]["digest"])'
    )" || return 1
    [ "$manifest_config_id" = "$expected_config_id" ] || return 1
  else
    return 1
  fi
  [ "$(sudo docker image inspect --format '{{.Id}}' "$runtime_id")" = "$runtime_id" ] \
    || return 1
  printf '%s\n' "$runtime_id"
}

backend_id="$(resolve_runtime_id \
  "$backend_ref" "$backend_registry_digest" "$backend_config_id")" \
  || { echo 'Backend image identity check failed.' >&2; exit 1; }
frontend_id="$(resolve_runtime_id \
  "$frontend_ref" "$frontend_registry_digest" "$frontend_config_id")" \
  || { echo 'Frontend image identity check failed.' >&2; exit 1; }
printf 'backend=%s\nfrontend=%s\n' "$backend_id" "$frontend_id"
```

Both runtime IDs must match `^sha256:[0-9a-f]{64}$`. Docker's classic image store normally uses the evidence `local_image_id` (the platform config digest). Docker 29's containerd image store may instead require the evidence `registry_digest` (the manifest digest); in that branch, the raw immutable manifest must bind back to the evidence `local_image_id` exactly. The supervisor accepts only the verified bare runtime ID, never a mutable tag, so a later tag change cannot alter a running or replacement generation.

For private GHCR packages, perform only the pull through an ephemeral authenticated configuration, then remove it:

```bash
pull_config="$(mktemp -d)"
cleanup_pull_config() {
  sudo docker --config "$pull_config" logout ghcr.io > /dev/null 2>&1 || true
  sudo rm -rf -- "$pull_config"
}
trap cleanup_pull_config EXIT HUP INT TERM
read -r -p 'GitHub package user: ' package_user
read -r -s -p 'GitHub read-only package token: ' package_token
printf '\n'
printf '%s' "$package_token" \
  | sudo docker --config "$pull_config" login ghcr.io --username "$package_user" --password-stdin
unset package_token
sudo docker --config "$pull_config" pull "$backend_ref"
sudo docker --config "$pull_config" pull "$frontend_ref"
sudo docker --config "$pull_config" logout ghcr.io
sudo rm -rf -- "$pull_config"
trap - EXIT HUP INT TERM
```

## 4. Discover the proxy boundary

Do not guess Docker addresses. Resolve the address Coolify's proxy uses for the host and list the proxy's own network addresses:

```bash
proxy_container=coolify-proxy
sudo docker inspect "$proxy_container" --format \
  '{{range $name, $network := .NetworkSettings.Networks}}{{println $name $network.IPAddress}}{{end}}'
sudo docker exec "$proxy_container" getent ahostsv4 host.docker.internal
```

Use the first verified private IPv4 returned for `host.docker.internal` as `RECIPE_LAB_LISTEN_HOST`. Confirm it is assigned to the host and reachable from the proxy.

Identify the Docker network used by the proxy for this host path, then inspect both its canonical subnet and every attached container:

```bash
proxy_network=<reviewed-coolify-proxy-network>
sudo docker network inspect "$proxy_network" --format \
  '{{range .IPAM.Config}}{{println .Subnet .Gateway}}{{end}}'
sudo docker network inspect "$proxy_network" --format \
  '{{range .Containers}}{{println .Name .IPv4Address}}{{end}}'
```

With the second proof factor below, prefer that audited canonical proxy-network CIDR for `RECIPE_LAB_TRUSTED_PROXY_CIDRS`; it tolerates a normal proxy container address change without interrupting MAGE. It must be private, no broader than `/16` for IPv4 or `/64` for IPv6, and contain no unreviewed containers. An exact stable proxy address is also accepted. Do not restart `coolify-proxy` merely to test address stability.

Generate the 32-byte proxy proof on the host without printing it and keep the source file root-only:

```bash
sudo install -o root -g root -m 0600 /dev/null /etc/recipe-lab/proxy-proof
sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/recipe-lab/proxy-proof'
```

Step 6 copies it into the protected service environment without displaying it. Insert the same root-only value into the Traefik proof middleware in step 7 through a protected administrative channel; do not put it in a command argument, Git, terminal transcript, ticket, or screenshot.

The frontend ignores `X-Forwarded-For` unless the direct socket peer matches `TRUSTED_PROXY_CIDRS` **and** the proof header matches `TRUSTED_PROXY_PROOF_SECRET`; it then strips the proof before application handling. Traefik's middleware must overwrite any client-supplied proof header. The public Traefik entrypoint must also keep `forwardedHeaders.insecure=false`; do not configure public clients as trusted forwarded-header sources. See Traefik's [forwarded-header boundary](https://doc.traefik.io/traefik/routing/entrypoints/#forwarded-headers).

Certify this boundary again after any proxy-network or Coolify proxy change:

1. Record the proxy container ID, its exact IP/network, and the resolved host-gateway address.
2. Confirm no other unreviewed container shares an allowed trusted range.
3. Send staging requests with forged `X-Forwarded-For` and `X-Recipe-Lab-Proxy-Proof` values and confirm Traefik replaces the proof and the app does not accept either client value as an independently trusted client.
4. Confirm an ordinary request through Traefik receives a proxy-derived client signal and normal network rate limiting.
5. Record the audited proxy-network membership and chosen CIDR. Repeat this audit after a normal, separately scheduled Coolify proxy change; do not restart the shared proxy for this test.

Do not expose a diagnostic endpoint that returns client addresses. Use bounded staging tests and remove their temporary evidence with the generation reset.

## 5. Rehearse before installing the service

The rehearsal requires Python 3.12+ and `cryptography`. Do not install an unpinned package with ad-hoc `pip`. Build a small host rehearsal environment from the reviewed `uv.lock`, using the same digest-pinned uv tool image as the backend build:

```bash
cd /opt/recipe-lab/current
python3 -c 'import sys; assert sys.version_info >= (3, 12)'
sudo install -d -o root -g root -m 0755 /opt/recipe-lab/tooling
uv_image='ghcr.io/astral-sh/uv:0.12.6@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d'
uv_stage="$(mktemp -d)"
sudo docker pull "$uv_image"
uv_container="$(sudo docker create "$uv_image")"
sudo docker cp "$uv_container:/uv" "$uv_stage/uv"
sudo docker rm "$uv_container"
sudo install -o root -g root -m 0755 "$uv_stage/uv" /opt/recipe-lab/tooling/uv-0.12.6
sudo rm "$uv_stage/uv"
rmdir "$uv_stage"
test "$(/opt/recipe-lab/tooling/uv-0.12.6 --version)" = 'uv 0.12.6'
sudo env \
  UV_PROJECT_ENVIRONMENT=/opt/recipe-lab/tooling/rehearsal-venv \
  UV_PYTHON_DOWNLOADS=never \
  /opt/recipe-lab/tooling/uv-0.12.6 sync \
    --frozen \
    --package recipe-lab-api \
    --no-dev \
    --no-install-workspace
sudo -u recipe-lab-sandbox -- \
  /opt/recipe-lab/tooling/rehearsal-venv/bin/python -c 'import cryptography'
```

From the exact release source, run the repository-owned two-generation rehearsal using that locked interpreter and the verified runtime IDs:

```bash
cd /opt/recipe-lab/current
sudo -u recipe-lab-sandbox -- \
  /opt/recipe-lab/tooling/rehearsal-venv/bin/python \
    -m scripts.rehearse_portfolio_sandbox \
    --backend-image "$backend_id" \
    --frontend-image "$frontend_id"
```

The rehearsal must prove independent visitors, normal demo mutations, expiry, full replacement, and rejection of stale cookies/content. It uses loopback TLS and does not certify Coolify, the EC2 firewall, systemd, or host backup policy.

## 6. Install the fail-closed host service

Install the reviewed unit and create its protected configuration from the example. The populated file contains the proxy-proof secret and stays mode `0640`:

```bash
sudo install -o root -g root -m 0644 \
  /opt/recipe-lab/current/deploy/systemd/recipe-lab-portfolio-sandbox.service \
  /etc/systemd/system/recipe-lab-portfolio-sandbox.service
sudo install -o root -g recipe-lab-sandbox -m 0640 \
  /opt/recipe-lab/current/deploy/systemd/sandbox.env.example \
  /etc/recipe-lab/sandbox.env
sudoedit /etc/recipe-lab/sandbox.env
sudo python3 - <<'PY'
import os
import re
from pathlib import Path

environment_path = Path("/etc/recipe-lab/sandbox.env")
proof = Path("/etc/recipe-lab/proxy-proof").read_text(encoding="ascii").strip()
if re.fullmatch(r"[0-9a-f]{64}", proof) is None:
    raise SystemExit("The proxy proof is invalid.")
placeholder = "TRUSTED_PROXY_PROOF_SECRET=<64-lowercase-hex-characters-generated-on-host>"
environment = environment_path.read_text(encoding="utf-8")
if environment.count(placeholder) != 1:
    raise SystemExit("The proxy-proof placeholder is missing or duplicated.")
environment_path.write_text(environment.replace(placeholder, f"TRUSTED_PROXY_PROOF_SECRET={proof}"), encoding="utf-8")
os.chmod(environment_path, 0o640)
PY
test "$(sudo grep -Ec '^TRUSTED_PROXY_PROOF_SECRET=[0-9a-f]{64}$' /etc/recipe-lab/sandbox.env)" -eq 1
sudo systemd-analyze verify /etc/systemd/system/recipe-lab-portfolio-sandbox.service
sudo systemctl daemon-reload
sudo systemctl enable --now recipe-lab-portfolio-sandbox.service
```

Replace every placeholder in `sandbox.env`. Set the two IDs resolved in step 3, the final HTTPS origin, a public contact URL or `mailto:` address, the verified private host-gateway IP, and the certified proxy IP/CIDR.

Check the service without printing container environments:

```bash
sudo systemctl status recipe-lab-portfolio-sandbox.service --no-pager
curl --fail --silent --show-error \
  "http://<private-host-gateway-ipv4>:3100/readyz"
sudo ss -lntp '( sport = :3100 )'
```

`/readyz` returns `ready` only when the frontend, backend, and database path is ready **and** the supervisor's exact-file heartbeat is fresh. Concurrent checks share one backend probe and successful or failed results are cached for one second. `/healthz` proves only that the frontend process is alive and must not be used for traffic admission.

The unit runs with a root-owned release tree, a dedicated user, a read-only host filesystem view, no capabilities, no core dumps, a 256 MiB supervisor memory ceiling, no supervisor swap, at most 64 supervisor tasks, and bounded restart behavior. These systemd limits cover the Python supervisor and its short-lived Docker client processes. Docker-created frontend, backend, and database containers stay under their separate CPU, PID, 768 MiB memory, and zero-additional-swap limits. The account receives Docker access solely because the supervisor must create and destroy those exact generation-owned containers.

The state directory is `/var/lib/recipe-lab-sandbox`:

- `supervisor.lock` is held for the process lifetime and prevents a second supervisor. Keep it during normal recovery.
- `fail-stop` records cleanup or ownership uncertainty without visitor details. Exit status `78` prevents systemd from restarting into uncertainty.

The runtime directory is `/run/recipe-lab-sandbox`. Each generation receives one empty, randomly named heartbeat file that is mounted read-only into its frontend. The supervisor touches that exact inode every 10 seconds while healthy. Before cleanup or a controlled failure it marks the inode stale and unlinks the host name; after an abrupt supervisor death, readiness fails within the 30-second freshness limit even if Docker cleanup cannot run. These files contain no visitor data and are invalidated conservatively at the next startup.

Never create, replace, edit, touch, chmod, or delete heartbeat files while the service is running. Stop and investigate the service if an operator believes heartbeat repair is needed.

## 7. Add a protected Coolify route

Create the `recipes.peterbucci.com` A record at the EC2 Elastic IP. In Coolify, add a Traefik dynamic configuration rather than a Coolify application. Confirm the actual HTTPS entrypoint and certificate-resolver names from Coolify's current proxy configuration before saving; the example uses the common `https` and `letsencrypt` names.

Generate a staging Basic Auth bcrypt entry locally with `htpasswd -nB reviewer`. Keep the password out of Git, the dynamic-configuration name, and screenshots. Paste the complete resulting `reviewer:$2y$...` line (including `reviewer:` exactly once) into this staging configuration:

```yaml
http:
  routers:
    recipe-lab-sandbox:
      rule: Host(`recipes.peterbucci.com`)
      entryPoints:
        - https
      service: recipe-lab-sandbox
      middlewares:
        - recipe-lab-sandbox-proxy-proof
        - recipe-lab-sandbox-staging-auth
      tls:
        certResolver: letsencrypt
      observability:
        accessLogs: false
        metrics: false
        tracing: false

    recipe-lab-sandbox-http:
      rule: Host(`recipes.peterbucci.com`)
      entryPoints:
        - http
      service: recipe-lab-sandbox
      middlewares:
        - recipe-lab-sandbox-https-redirect
      observability:
        accessLogs: false
        metrics: false
        tracing: false

  middlewares:
    recipe-lab-sandbox-proxy-proof:
      headers:
        customRequestHeaders:
          X-Recipe-Lab-Proxy-Proof: '<same-64-character-lowercase-hex-secret>'

    recipe-lab-sandbox-staging-auth:
      basicAuth:
        removeHeader: true
        users:
          - '<complete-reviewer-colon-bcrypt-entry>'

    recipe-lab-sandbox-https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    recipe-lab-sandbox:
      loadBalancer:
        passHostHeader: true
        healthCheck:
          path: /readyz
          interval: 10s
          timeout: 7s
        servers:
          - url: http://host.docker.internal:3100
```

The header middleware overwrites any proof value supplied by a visitor; it must contain the exact value installed as `TRUSTED_PROXY_PROOF_SECRET`. Treat this dynamic configuration as sensitive and do not export it into tickets or screenshots. Router-level access-log, metric, and trace disabling prevents this public demo route from inheriting a more expansive global collection policy. Traefik documents these [per-router observability controls](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/observability/) and the [file-provider service health check](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/file/).

After Coolify accepts the configuration:

```bash
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  https://recipes.peterbucci.com/readyz)" = 401
```

The unauthenticated request should receive `401` during staging. With staging credentials it should return `200`, an HTTPS certificate for the exact hostname, and `Cache-Control: no-store`. An HTTP request must redirect to HTTPS. Direct requests to the EC2 public IP on port `3100` must time out or be rejected.

## 8. Complete hosted certification

Complete and retain bounded, sanitized evidence for issue #279 before public access:

1. **Exact release:** source commit, release workflow run, both GHCR manifest digests, both matching platform config IDs, and the verified runtime IDs used by this host.
2. **Host privacy:** no swap, no database volume/backup/replica/archive, no crash dumps, container log driver `none`, no proxy access log/trace for this router, and reviewed EBS/AWS backup behavior.
3. **Network boundary:** only ports 80/443 public; 3100 bound only to the private host-gateway address; backend/PostgreSQL have no host listener; trusted proxy and spoof-resistance checks pass.
4. **HTTPS behavior:** correct certificate, HTTP redirect, exact production origin, Secure/HttpOnly/SameSite cookies, CSRF rejection, and no OIDC path in sandbox mode.
5. **Whole-stack readiness:** `/readyz` leaves rotation when PostgreSQL or the backend becomes unavailable, when the supervisor heartbeat is invalidated, or within 30 seconds of an abrupt supervisor death; `/healthz` remains a process-only probe. A concurrent readiness-request burst must result in at most one in-flight backend probe and no more than one new probe per one-second cache interval.
6. **Lifecycle:** two independent visitors can use the demo; generation expiry destroys their content; the next generation rejects both old sessions; a systemd restart cleans or reconciles only exact labeled resources.
7. **Failure behavior:** killing each sandbox container withdraws readiness and stops the generation; killing the supervisor makes readiness fail within the heartbeat deadline; simulated cleanup uncertainty invalidates the heartbeat, writes `fail-stop`, returns `78`, and does not restart or admit traffic.
8. **Capacity:** record peak host memory, disk, and CPU during startup and two active visitors. Keep the `t3.medium` only if MAGE and the sandbox retain safe headroom.

Reset the staging generation after certification so test accounts and mutations are destroyed.

## 9. Open public routing

Public launch is one small change: remove only the `recipe-lab-sandbox-staging-auth` middleware from the HTTPS router, then delete the now-unused Basic Auth block. Keep `recipe-lab-sandbox-proxy-proof`. Do not change the proof secret, service URL, TLS, HTTP redirect, health check, observability, firewall, listener, or trusted-proxy configuration.

Verify from a new browser session and a separate network:

- HTTPS loads without Basic Auth;
- `/readyz` is `200` and `no-store`;
- demo entry works without OIDC;
- a forged forwarding header does not bypass network rate limiting; and
- MAGE remains healthy.

This completes the deployment portion of issue #21. Portfolio screenshots and public wording belong to issue #22 after the hosted behavior is proven.

## Rollback and fail-stop recovery

### Planned rollback

Use the prior release's retained `release-evidence.json`. Pull both prior digest-qualified references, verify their runtime IDs and config-to-manifest bindings as above, and rehearse that exact pair. Then:

1. Re-add staging Basic Auth to withdraw general public access.
2. Stop the service and confirm the current generation is fully removed.
3. Atomically replace `/etc/recipe-lab/sandbox.env` with the prior verified runtime IDs and point `/opt/recipe-lab/current` to the matching prior source commit.
4. Run `systemd-analyze verify`, start the service, and require `/readyz` through Coolify.
5. Repeat the hosted smoke and stale-session checks before removing staging protection.

Never roll back one image without the other or pair images with a different supervisor commit.

### Fail-stop recovery

If the unit exits `78`, leave `/var/lib/recipe-lab-sandbox/fail-stop` in place. The route should return unavailable because no healthy frontend is admitted.

List only resources carrying the supervisor's ownership label:

```bash
sudo docker container ls --all \
  --filter label=org.recipe-lab.portfolio-generation
sudo docker network ls \
  --filter label=org.recipe-lab.portfolio-generation
sudo ss -lntp '( sport = :3100 )'
```

Inspect every candidate's exact name and `org.recipe-lab.portfolio-generation` label. Remove only resources whose name, UUID, role, and label all match the repository's ownership rules. Do not use `docker system prune`, a name glob, or a broad label deletion.

Only after port 3100 is closed and every exact owned resource is absent may an operator remove `/var/lib/recipe-lab-sandbox/fail-stop`. Keep `supervisor.lock`; it is not an error marker. Start under staging protection, confirm `/readyz`, and redo the lifecycle checks before reopening public traffic.
