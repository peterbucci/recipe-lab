import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import nextEnvironment from "@next/env";

import {
  buildNetworkSignalHeaders,
  UNTRUSTED_FORWARDING_HEADERS,
} from "./server/trusted-network-signal.mjs";
import { runtimeConfiguration } from "./server/runtime-config.mjs";

const { loadEnvConfig } = nextEnvironment;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function hardenIncomingNetworkHeaders(
  headers,
  { remoteAddress, method, path, secret, timestamp },
) {
  for (const header of UNTRUSTED_FORWARDING_HEADERS) {
    delete headers[header];
  }
  if (!path.startsWith("/api/")) {
    return headers;
  }
  const signal = buildNetworkSignalHeaders({
    remoteAddress,
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

  createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://recipe-lab.internal")
      .pathname;
    if (handleHealthCheck(request, response, path)) {
      return;
    }
    hardenIncomingNetworkHeaders(request.headers, {
      remoteAddress: request.socket.remoteAddress,
      method: request.method ?? "GET",
      path,
      secret: networkSignalValue,
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
