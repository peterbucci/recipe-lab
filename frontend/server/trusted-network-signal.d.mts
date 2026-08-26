export const NETWORK_HEADER: string;
export const NETWORK_TIMESTAMP_HEADER: string;
export const NETWORK_SIGNATURE_HEADER: string;
export const NETWORK_SIGNAL_HEADERS: string[];
export const UNTRUSTED_FORWARDING_HEADERS: string[];

export function canonicalizeClientNetwork(remoteAddress: unknown): string | null;
export function internalNetworkSignalSecret(
  environment?: Record<string, string | undefined>,
): string;
export function signNetworkSignal(input: {
  network: string;
  timestamp: number;
  method: string;
  path: string;
  secret: string;
}): string;
export function buildNetworkSignalHeaders(input: {
  remoteAddress: unknown;
  method: string;
  path: string;
  secret: string;
  timestamp?: number;
}): Record<string, string> | null;
export function verifyNetworkSignalHeaders(
  headers: Headers,
  input: {
    method: string;
    path: string;
    secret: string;
    now?: number;
    ttlSeconds?: number;
  },
): Record<string, string> | null;
