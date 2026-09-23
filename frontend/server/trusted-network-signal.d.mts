export const NETWORK_HEADER: string;
export const NETWORK_TIMESTAMP_HEADER: string;
export const NETWORK_SIGNATURE_HEADER: string;
export const PROXY_PROOF_HEADER: string;
export const NETWORK_SIGNAL_HEADERS: string[];
export const UNTRUSTED_FORWARDING_HEADERS: string[];

export interface TrustedProxyConfiguration {
  cidrs: readonly string[];
  proofSecret: string | null;
}

export function canonicalizeClientNetwork(remoteAddress: unknown): string | null;
export function trustedProxyConfiguration(
  environment?: Record<string, string | undefined>,
): Readonly<TrustedProxyConfiguration>;
export function resolveClientAddress(input: {
  remoteAddress: unknown;
  forwardedFor?: string | string[];
  proxyProof?: string | string[];
  trustedProxyCidrs?: readonly string[];
  trustedProxyProofSecret?: string | null;
}): string | null;
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
