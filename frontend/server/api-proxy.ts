import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  internalNetworkSignalSecret,
  UNTRUSTED_FORWARDING_HEADERS,
  verifyNetworkSignalHeaders,
} from "./trusted-network-signal.mjs";

interface ApiProxyContext {
  params: Promise<{ path: string[] }>;
}

type StreamingRequestInit = RequestInit & { duplex?: "half" };

class InvalidApiPathError extends Error {}

const REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-correlation-id",
  ...UNTRUSTED_FORWARDING_HEADERS,
];

const RESPONSE_HEADERS_TO_REMOVE = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const PROXY_TIMEOUT_MS = 10_000;
const CORRELATION_HEADER = "X-Correlation-ID";
const SAFE_CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type FrontendFailureEvent =
  | "recipe_lab.frontend.authentication_failed"
  | "recipe_lab.frontend.recipe_api_unavailable";

function newCorrelationId(): string {
  return randomUUID();
}

function trustedCorrelationId(upstream: Response): string {
  const value = upstream.headers.get(CORRELATION_HEADER);
  return value !== null && SAFE_CORRELATION_ID.test(value) ? value : newCorrelationId();
}

function recordFailure(event: FrontendFailureEvent, correlationId: string, statusCode: number) {
  console.error(
    JSON.stringify({
      event,
      correlation_id: correlationId,
      status_code: statusCode,
    }),
  );
}

function errorResponse({
  correlationId,
  status,
  code,
  message,
}: {
  correlationId: string;
  status: number;
  code: string;
  message: string;
}): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        issues: [],
        correlation_id: correlationId,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        [CORRELATION_HEADER]: correlationId,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function backendBaseUrl(): URL {
  const configured = process.env.RECIPE_API_URL ?? "http://localhost:8000";
  const url = new URL(configured.trim());

  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new Error("RECIPE_API_URL must be an HTTP(S) URL without embedded credentials.");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("RECIPE_API_URL must identify an origin without a path, query, or hash.");
  }

  url.search = "";
  url.hash = "";
  return url;
}

function upstreamUrl(request: NextRequest, path: string[]): URL {
  if (
    !path.length ||
    path.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    throw new InvalidApiPathError("The API path is invalid.");
  }

  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(`/api/${encodedPath}`, backendBaseUrl());
  url.search = request.nextUrl.search;
  return url;
}

function proxyResponse(upstream: Response, method: string): Response {
  const headers = new Headers(upstream.headers);
  for (const name of RESPONSE_HEADERS_TO_REMOVE) {
    headers.delete(name);
  }

  // Preserve separate Set-Cookie fields when the runtime exposes them individually.
  const setCookies = (
    upstream.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (setCookies?.length) {
    headers.delete("set-cookie");
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
  }

  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function callbackErrorResponse(
  request: NextRequest,
  upstreamStatus: number,
  correlationId: string,
): Response {
  const errorCode =
    upstreamStatus >= 400 && upstreamStatus < 500
      ? "invalid_login"
      : "authentication_unavailable";
  recordFailure(
    "recipe_lab.frontend.authentication_failed",
    correlationId,
    upstreamStatus,
  );

  const cookieSecure = request.nextUrl.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: `/auth/callback?error=${errorCode}`,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `recipe_lab_login=; Path=/api/auth/callback; Max-Age=0; HttpOnly; SameSite=Lax${cookieSecure}`,
      [CORRELATION_HEADER]: correlationId,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function callbackRateLimitResponse(request: NextRequest, upstream: Response): Response {
  const response = proxyResponse(upstream, request.method);
  const cookieSecure = request.nextUrl.protocol === "https:" ? "; Secure" : "";
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.append(
    "Set-Cookie",
    `recipe_lab_login=; Path=/api/auth/callback; Max-Age=0; HttpOnly; SameSite=Lax${cookieSecure}`,
  );
  return response;
}

function isSafeCallbackSuccess(request: NextRequest, upstream: Response): boolean {
  const location = upstream.headers.get("location");
  if (
    upstream.status !== 303 ||
    location === null ||
    !location.startsWith("/") ||
    location.startsWith("//")
  ) {
    return false;
  }

  try {
    return new URL(location, request.nextUrl.origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function proxyApiRequest(
  request: NextRequest,
  context: ApiProxyContext,
): Promise<Response> {
  let isAuthCallback = false;
  try {
    const { path } = await context.params;
    isAuthCallback =
      request.method === "GET" &&
      path.length === 2 &&
      path[0] === "auth" &&
      path[1] === "callback";
    const trustedNetworkHeaders = verifyNetworkSignalHeaders(request.headers, {
      method: request.method,
      path: request.nextUrl.pathname,
      secret: internalNetworkSignalSecret(),
    });
    const headers = new Headers(request.headers);
    for (const name of REQUEST_HEADERS_TO_REMOVE) {
      headers.delete(name);
    }
    if (trustedNetworkHeaders) {
      for (const [name, value] of Object.entries(trustedNetworkHeaders)) {
        headers.set(name, value);
      }
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamSignal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(PROXY_TIMEOUT_MS),
    ]);
    const requestInit: StreamingRequestInit = {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      signal: upstreamSignal,
      duplex: hasBody ? "half" : undefined,
    };
    const proxyRequest = new Request(upstreamUrl(request, path), requestInit);

    const upstream = await fetch(proxyRequest, {
      cache: "no-store",
      redirect: "manual",
    });
    if (isAuthCallback) {
      if (upstream.status === 429) {
        return callbackRateLimitResponse(request, upstream);
      }
      if (!isSafeCallbackSuccess(request, upstream)) {
        return callbackErrorResponse(
          request,
          upstream.status,
          trustedCorrelationId(upstream),
        );
      }
    }
    return proxyResponse(upstream, request.method);
  } catch (reason) {
    const correlationId = newCorrelationId();
    if (isAuthCallback) {
      return callbackErrorResponse(request, 503, correlationId);
    }
    if (reason instanceof InvalidApiPathError) {
      return errorResponse({
        correlationId,
        status: 400,
        code: "invalid_api_path",
        message: "The requested API path is invalid.",
      });
    }

    recordFailure(
      "recipe_lab.frontend.recipe_api_unavailable",
      correlationId,
      502,
    );
    return errorResponse({
      correlationId,
      status: 502,
      code: "api_unavailable",
      message: "Recipe Lab could not reach the recipe service.",
    });
  }
}
