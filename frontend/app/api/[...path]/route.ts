import type { NextRequest } from "next/server";

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

function callbackErrorResponse(request: NextRequest, upstreamStatus: number): Response {
  const errorCode =
    upstreamStatus >= 400 && upstreamStatus < 500
      ? "invalid_login"
      : "authentication_unavailable";

  const cookieSecure = request.nextUrl.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: `/auth/callback?error=${errorCode}`,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `recipe_lab_login=; Path=/api/auth/callback; Max-Age=0; HttpOnly; SameSite=Lax${cookieSecure}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
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
    const headers = new Headers(request.headers);
    for (const name of REQUEST_HEADERS_TO_REMOVE) {
      headers.delete(name);
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
      if (!isSafeCallbackSuccess(request, upstream)) {
        return callbackErrorResponse(request, upstream.status);
      }
    }
    return proxyResponse(upstream, request.method);
  } catch (reason) {
    if (isAuthCallback) {
      return callbackErrorResponse(request, 503);
    }
    if (reason instanceof InvalidApiPathError) {
      return Response.json(
        {
          error: {
            code: "invalid_api_path",
            message: "The requested API path is invalid.",
          },
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    return Response.json(
      {
        error: {
          code: "api_unavailable",
          message: "Recipe Lab could not reach the recipe service.",
        },
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}

export const dynamic = "force-dynamic";

export const GET = proxyApiRequest;
export const POST = proxyApiRequest;
export const PUT = proxyApiRequest;
export const PATCH = proxyApiRequest;
export const DELETE = proxyApiRequest;
export const HEAD = proxyApiRequest;
export const OPTIONS = proxyApiRequest;
