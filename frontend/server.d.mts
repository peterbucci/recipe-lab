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
  },
): IncomingHttpHeaders;

export function handleHealthCheck(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): boolean;
