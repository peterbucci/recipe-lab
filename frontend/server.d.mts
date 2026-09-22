import type { IncomingHttpHeaders } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export function hardenIncomingNetworkHeaders(
  headers: IncomingHttpHeaders,
  input: {
    remoteAddress: unknown;
    method: string;
    path: string;
    secret: string;
    timestamp?: number;
    forwardedFor?: string | string[];
    proxyProof?: string | string[];
    trustedProxyCidrs?: readonly string[];
    trustedProxyProofSecret?: string | null;
  },
): IncomingHttpHeaders;

export function hardenIncomingNetworkRequest(
  request: IncomingMessage,
  input: {
    remoteAddress: unknown;
    method: string;
    path: string;
    secret: string;
    timestamp?: number;
    trustedProxyCidrs?: readonly string[];
    trustedProxyProofSecret?: string | null;
  },
): IncomingHttpHeaders;

export function handleHealthCheck(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): boolean;

export function handleReadinessCheck(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: {
    readinessProbe: () => Promise<boolean>;
  },
): Promise<boolean>;

export function createReadinessProbe(options: {
  recipeApiUrl: string;
  fetchImpl?: typeof fetch;
  supervisorHeartbeat?: {
    path: string;
    ttlSeconds: number;
  } | null;
  statImpl?: (path: string) => Promise<{
    isFile(): boolean;
    mtimeMs: number;
  }>;
  monotonicClock?: () => number;
  wallClock?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
}): () => Promise<boolean>;
