import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import nextEnvironment from "@next/env";

import {
  buildNetworkSignalHeaders,
  PROXY_PROOF_HEADER,
  resolveClientAddress,
  UNTRUSTED_FORWARDING_HEADERS,
} from "./server/trusted-network-signal.mjs";
import { runtimeConfiguration } from "./server/runtime-config.mjs";

const { loadEnvConfig } = nextEnvironment;

const READINESS_TIMEOUT_MS = 3_000;
const READINESS_CACHE_TTL_MS = 1_000;
const HEARTBEAT_FUTURE_SKEW_MS = 2_000;
const UNTRUSTED_HEADER_NAMES = new Set(UNTRUSTED_FORWARDING_HEADERS);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function hardenIncomingNetworkHeaders(headers, input) {
  const {
    remoteAddress,
    method,
    path,
    secret,
    timestamp,
    trustedProxyCidrs = [],
    trustedProxyProofSecret = null,
    forwardedFor = headers["x-forwarded-for"],
    proxyProof = headers[PROXY_PROOF_HEADER],
  } = input;
  const clientAddress = resolveClientAddress({
    remoteAddress,
    forwardedFor,
    proxyProof,
    trustedProxyCidrs,
    trustedProxyProofSecret,
  });
  for (const header of UNTRUSTED_FORWARDING_HEADERS) {
    delete headers[header];
  }
  if (!path.startsWith("/api/")) {
    return headers;
  }
  const signal = buildNetworkSignalHeaders({
    remoteAddress: clientAddress,
    method,
    path,
    secret,
    timestamp,
  });
  if (signal) {
    Object.assign(headers, signal);
  }
  return headers;
}

function stripUntrustedHeaderRecord(headers) {
  if (!headers || typeof headers !== "object") {
    return;
  }
  for (const name of Object.keys(headers)) {
    if (UNTRUSTED_HEADER_NAMES.has(name.toLowerCase())) {
      delete headers[name];
    }
  }
}

function stripUntrustedRawHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders)) {
    return;
  }
  let writeIndex = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (
      typeof name === "string" &&
      UNTRUSTED_HEADER_NAMES.has(name.toLowerCase())
    ) {
      continue;
    }
    rawHeaders[writeIndex] = name;
    writeIndex += 1;
    if (value !== undefined) {
      rawHeaders[writeIndex] = value;
      writeIndex += 1;
    }
  }
  rawHeaders.length = writeIndex;
}

function stripUntrustedTrailers(request) {
  stripUntrustedHeaderRecord(request.trailers);
  stripUntrustedHeaderRecord(request.trailersDistinct);
  stripUntrustedRawHeaders(request.rawTrailers);
}

export function hardenIncomingNetworkRequest(request, input) {
  const distinctHeaders = request.headersDistinct;
  const forwardedFor =
    distinctHeaders?.["x-forwarded-for"] ?? request.headers["x-forwarded-for"];
  const proxyProof =
    distinctHeaders?.[PROXY_PROOF_HEADER] ?? request.headers[PROXY_PROOF_HEADER];

  stripUntrustedHeaderRecord(request.headers);
  stripUntrustedHeaderRecord(distinctHeaders);
  stripUntrustedRawHeaders(request.rawHeaders);
  stripUntrustedTrailers(request);
  hardenIncomingNetworkHeaders(request.headers, {
    ...input,
    forwardedFor,
    proxyProof,
  });
  if (!request.complete) {
    request.prependOnceListener("end", () => stripUntrustedTrailers(request));
  }
  return request.headers;
}

export function handleHealthCheck(request, response, path) {
  if (path !== "/healthz") {
    return false;
  }
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, HEAD");
    response.setHeader("Content-Length", "0");
    response.end();
    return true;
  }
  const body = "ok\n";
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

function writeReadinessResponse(request, response, ready) {
  const body = ready ? "ready\n" : "unavailable\n";
  response.statusCode = ready ? 200 : 503;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(request.method === "HEAD" ? undefined : body);
}

async function heartbeatIsFresh(heartbeat, { statImpl, wallClock }) {
  if (!heartbeat) {
    return true;
  }
  try {
    const heartbeatStat = await statImpl(heartbeat.path);
    const modifiedAt = heartbeatStat.mtimeMs;
    const age = wallClock() - modifiedAt;
    return (
      heartbeatStat.isFile() &&
      Number.isFinite(modifiedAt) &&
      age >= -HEARTBEAT_FUTURE_SKEW_MS &&
      age <= heartbeat.ttlSeconds * 1_000
    );
  } catch {
    return false;
  }
}

export function createReadinessProbe({
  recipeApiUrl,
  fetchImpl = globalThis.fetch,
  supervisorHeartbeat = null,
  statImpl = stat,
  monotonicClock = () => performance.now(),
  wallClock = Date.now,
  timeoutMs = READINESS_TIMEOUT_MS,
  cacheTtlMs = READINESS_CACHE_TTL_MS,
}) {
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 5_000) {
    throw new Error("The readiness cache TTL must be between 0 and 5000 milliseconds.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new Error("The readiness timeout must be between 1 and 10000 milliseconds.");
  }

  const readinessUrl = new URL("/api/readiness", recipeApiUrl);
  let cachedResult = null;
  let inFlight = null;
  let cacheGeneration = 0;

  function invalidateCache() {
    cachedResult = null;
    cacheGeneration += 1;
  }

  async function probeBackend() {
    const checkedAt = monotonicClock();
    if (
      cachedResult &&
      checkedAt >= cachedResult.checkedAt &&
      checkedAt - cachedResult.checkedAt <= cacheTtlMs
    ) {
      return cachedResult.ready;
    }
    cachedResult = null;
    if (inFlight) {
      return inFlight;
    }

    const startedGeneration = cacheGeneration;
    const backendRequest = (async () => {
      let ready = false;
      try {
        const upstream = await fetchImpl(readinessUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        ready = upstream.status === 200;
        await upstream.body?.cancel();
      } catch {
        ready = false;
      }
      if (cacheGeneration === startedGeneration) {
        cachedResult = {
          checkedAt: monotonicClock(),
          ready,
        };
      }
      return ready;
    })();
    inFlight = backendRequest;
    try {
      return await backendRequest;
    } finally {
      if (inFlight === backendRequest) {
        inFlight = null;
      }
    }
  }

  return async function readinessProbe() {
    if (
      !(await heartbeatIsFresh(supervisorHeartbeat, { statImpl, wallClock }))
    ) {
      invalidateCache();
      return false;
    }

    const ready = await probeBackend();
    if (!ready) {
      return false;
    }

    if (
      !(await heartbeatIsFresh(supervisorHeartbeat, { statImpl, wallClock }))
    ) {
      invalidateCache();
      return false;
    }
    return true;
  };
}

export async function handleReadinessCheck(
  request,
  response,
  path,
  { readinessProbe },
) {
  if (path !== "/readyz") {
    return false;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, HEAD");
    response.setHeader("Content-Length", "0");
    response.end();
    return true;
  }

  const ready = await readinessProbe();
  writeReadinessResponse(request, response, ready);
  return true;
}

async function main() {
  const dev = process.argv.includes("--dev");
  process.env.NODE_ENV = dev ? "development" : "production";
  if (dev) {
    // Next's Turbopack workers must inherit this before Next is imported.
    process.env.__NEXT_DEV_SERVER = "1";
  } else {
    delete process.env.__NEXT_DEV_SERVER;
  }
  loadEnvConfig(process.cwd(), dev);
  const hostname = argumentValue("--hostname") ?? "0.0.0.0";
  const port = Number.parseInt(
    argumentValue("--port") ?? process.env.PORT ?? "3000",
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "The frontend port must be an integer between 1 and 65535.",
    );
  }
  const configuration = runtimeConfiguration(process.env, { development: dev });
  process.env.APP_ENVIRONMENT = configuration.appEnvironment;
  process.env.RECIPE_API_URL = configuration.recipeApiUrl;
  const networkSignalValue = configuration.internalNetworkSignalSecret;
  const { default: next } = await import("next");
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const readinessProbe = createReadinessProbe({
    recipeApiUrl: configuration.recipeApiUrl,
    supervisorHeartbeat: configuration.supervisorHeartbeat,
  });

  createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://recipe-lab.internal")
      .pathname;
    if (handleHealthCheck(request, response, path)) {
      return;
    }
    if (path === "/readyz") {
      void handleReadinessCheck(request, response, path, {
        readinessProbe,
      }).catch(() => response.destroy());
      return;
    }
    hardenIncomingNetworkRequest(request, {
      remoteAddress: request.socket.remoteAddress,
      method: request.method ?? "GET",
      path,
      secret: networkSignalValue,
      trustedProxyCidrs: configuration.trustedProxyCidrs,
      trustedProxyProofSecret: configuration.trustedProxyProofSecret,
    });
    void handle(request, response).catch(() => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Cache-Control", "no-store");
        response.end();
        return;
      }
      response.destroy();
    });
  }).listen(port, hostname);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
