import type { IncomingHttpHeaders } from "node:http";

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
