import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const NETWORK_HEADER = "x-recipe-lab-client-network";
export const NETWORK_TIMESTAMP_HEADER = "x-recipe-lab-network-timestamp";
export const NETWORK_SIGNATURE_HEADER = "x-recipe-lab-network-signature";
export const PROXY_PROOF_HEADER = "x-recipe-lab-proxy-proof";
export const NETWORK_SIGNAL_HEADERS = [
  NETWORK_HEADER,
  NETWORK_TIMESTAMP_HEADER,
  NETWORK_SIGNATURE_HEADER,
];
export const UNTRUSTED_FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  PROXY_PROOF_HEADER,
  ...NETWORK_SIGNAL_HEADERS,
];

const LOCAL_SIGNAL_SECRET = "recipe-lab-local-internal-network-signal-secret";
const DEFAULT_SIGNAL_TTL_SECONDS = 30;
const MAX_TRUSTED_PROXY_CIDRS = 32;
const MAX_TRUSTED_PROXY_CIDRS_LENGTH = 4_096;
const MAX_FORWARDED_FOR_HOPS = 32;
const MAX_FORWARDED_FOR_LENGTH = 4_096;
const TRUSTED_PROXY_CIDRS_ERROR =
  "TRUSTED_PROXY_CIDRS must contain exact IP addresses or canonical narrow CIDRs.";

function parseIpv4(address) {
  if (isIP(address) !== 4) {
    return null;
  }
  return address.split(".").map((part) => Number.parseInt(part, 10));
}

function ipv6Words(address) {
  const withoutZone = address.split("%", 1)[0].toLowerCase();
  if (isIP(withoutZone) !== 6) {
    return null;
  }

  let normalized = withoutZone;
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const ipv4 = parseIpv4(dottedTail);
    if (!ipv4) {
      return null;
    }
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, -dottedTail.length)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function compressIpv6(words) {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  for (let index = 0; index <= words.length; index += 1) {
    if (index < words.length && words[index] === 0) {
      currentStart = currentStart === -1 ? index : currentStart;
      continue;
    }
    if (currentStart !== -1 && index - currentStart > bestLength) {
      bestStart = currentStart;
      bestLength = index - currentStart;
    }
    currentStart = -1;
  }
  const rendered = words.map((word) => word.toString(16));
  if (bestLength < 2) {
    return rendered.join(":");
  }
  const left = rendered.slice(0, bestStart).join(":");
  const right = rendered.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

function parsedIpAddress(value, { allowZone = false } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const address = value.trim();
  if (!allowZone && address.includes("%")) {
    return null;
  }
  const withoutZone = address.split("%", 1)[0];
  const ipv4 = parseIpv4(withoutZone);
  if (ipv4) {
    return { family: 4, bytes: ipv4 };
  }
  const words = ipv6Words(withoutZone);
  if (!words) {
    return null;
  }
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    return {
      family: 4,
      bytes: [
        words[6] >> 8,
        words[6] & 0xff,
        words[7] >> 8,
        words[7] & 0xff,
      ],
    };
  }
  return {
    family: 6,
    bytes: words.flatMap((word) => [word >> 8, word & 0xff]),
  };
}

function canonicalIpAddress(address) {
  if (address.family === 4) {
    return address.bytes.join(".");
  }
  const words = Array.from({ length: 8 }, (_, index) =>
    (address.bytes[index * 2] << 8) | address.bytes[index * 2 + 1],
  );
  return compressIpv6(words);
}

function addressHasHostBits(address, prefixLength) {
  const fullBytes = Math.floor(prefixLength / 8);
  const partialBits = prefixLength % 8;
  if (
    partialBits > 0 &&
    (address.bytes[fullBytes] & (0xff >> partialBits)) !== 0
  ) {
    return true;
  }
  const hostStart = fullBytes + (partialBits > 0 ? 1 : 0);
  return address.bytes.slice(hostStart).some((byte) => byte !== 0);
}

function parseTrustedProxyEntry(entry) {
  const parts = entry.split("/");
  if (parts.length > 2 || !parts[0]) {
    throw new Error(TRUSTED_PROXY_CIDRS_ERROR);
  }
  const address = parsedIpAddress(parts[0]);
  if (!address) {
    throw new Error(TRUSTED_PROXY_CIDRS_ERROR);
  }
  const maximumPrefix = address.family === 4 ? 32 : 128;
  const prefixLength =
    parts.length === 1
      ? maximumPrefix
      : /^(0|[1-9]\d*)$/.test(parts[1] ?? "")
        ? Number.parseInt(parts[1], 10)
        : Number.NaN;
  const minimumPrefix = address.family === 4 ? 16 : 64;
  if (
    !Number.isInteger(prefixLength) ||
    prefixLength < minimumPrefix ||
    prefixLength > maximumPrefix ||
    addressHasHostBits(address, prefixLength)
  ) {
    throw new Error(TRUSTED_PROXY_CIDRS_ERROR);
  }
  return {
    address,
    prefixLength,
    canonical:
      parts.length === 1
        ? canonicalIpAddress(address)
        : `${canonicalIpAddress(address)}/${prefixLength}`,
  };
}

export function trustedProxyConfiguration(environment = process.env) {
  const rawCidrs = environment.TRUSTED_PROXY_CIDRS?.trim() ?? "";
  const proofSecret = environment.TRUSTED_PROXY_PROOF_SECRET ?? "";
  if (!rawCidrs && !proofSecret) {
    return Object.freeze({
      cidrs: Object.freeze([]),
      proofSecret: null,
    });
  }
  if (!rawCidrs || !proofSecret) {
    throw new Error(
      "TRUSTED_PROXY_CIDRS and TRUSTED_PROXY_PROOF_SECRET must be configured together.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(proofSecret)) {
    throw new Error(
      "TRUSTED_PROXY_PROOF_SECRET must be a 64-character lowercase hexadecimal secret.",
    );
  }
  if (rawCidrs.length > MAX_TRUSTED_PROXY_CIDRS_LENGTH) {
    throw new Error(TRUSTED_PROXY_CIDRS_ERROR);
  }
  const entries = rawCidrs.split(",");
  if (
    entries.length > MAX_TRUSTED_PROXY_CIDRS ||
    entries.some((entry) => !entry.trim())
  ) {
    throw new Error(TRUSTED_PROXY_CIDRS_ERROR);
  }
  const cidrs = [
    ...new Set(
      entries.map((entry) => parseTrustedProxyEntry(entry.trim()).canonical),
    ),
  ];
  return Object.freeze({
    cidrs: Object.freeze(cidrs),
    proofSecret,
  });
}

function addressMatchesRange(address, range) {
  if (address.family !== range.address.family) {
    return false;
  }
  const fullBytes = Math.floor(range.prefixLength / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (address.bytes[index] !== range.address.bytes[index]) {
      return false;
    }
  }
  const partialBits = range.prefixLength % 8;
  if (partialBits === 0) {
    return true;
  }
  const mask = (0xff << (8 - partialBits)) & 0xff;
  return (
    (address.bytes[fullBytes] & mask) ===
    (range.address.bytes[fullBytes] & mask)
  );
}

function proxyProofMatches(provided, expected) {
  if (Array.isArray(provided) && provided.length !== 1) {
    return false;
  }
  const providedValue = Array.isArray(provided) ? provided[0] : provided;
  if (typeof providedValue !== "string" || typeof expected !== "string") {
    return false;
  }
  const providedBytes = Buffer.from(providedValue, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function finalForwardedAddress(forwardedFor) {
  if (Array.isArray(forwardedFor) && forwardedFor.length !== 1) {
    return null;
  }
  const forwardedValue = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;
  if (
    typeof forwardedValue !== "string" ||
    forwardedValue.length > MAX_FORWARDED_FOR_LENGTH
  ) {
    return null;
  }
  const hops = forwardedValue.split(",");
  if (hops.length > MAX_FORWARDED_FOR_HOPS) {
    return null;
  }
  const address = parsedIpAddress(hops.at(-1));
  return address ? canonicalIpAddress(address) : null;
}

export function resolveClientAddress({
  remoteAddress,
  forwardedFor,
  proxyProof,
  trustedProxyCidrs = [],
  trustedProxyProofSecret = null,
}) {
  const directPeer = parsedIpAddress(remoteAddress, { allowZone: true });
  if (!directPeer) {
    return null;
  }
  const directAddress = canonicalIpAddress(directPeer);
  if (
    trustedProxyCidrs.length === 0 ||
    !proxyProofMatches(proxyProof, trustedProxyProofSecret)
  ) {
    return directAddress;
  }
  const trustedPeer = trustedProxyCidrs.some((entry) => {
    try {
      return addressMatchesRange(directPeer, parseTrustedProxyEntry(entry));
    } catch {
      return false;
    }
  });
  if (!trustedPeer) {
    return directAddress;
  }
  return finalForwardedAddress(forwardedFor) ?? directAddress;
}

export function canonicalizeClientNetwork(remoteAddress) {
  const address = parsedIpAddress(remoteAddress, { allowZone: true });
  if (!address) {
    return null;
  }
  if (address.family === 4) {
    return `${address.bytes[0]}.${address.bytes[1]}.${address.bytes[2]}.0/24`;
  }

  const words = Array.from({ length: 8 }, (_, index) =>
    (address.bytes[index * 2] << 8) | address.bytes[index * 2 + 1],
  );
  const networkWords = [words[0], words[1], words[2], words[3] & 0xff00, 0, 0, 0, 0];
  return `${compressIpv6(networkWords)}/56`;
}

export function internalNetworkSignalSecret(environment = process.env) {
  const configured = environment.INTERNAL_NETWORK_SIGNAL_SECRET?.trim();
  const production = environment.NODE_ENV === "production";
  if (!configured) {
    if (production) {
      throw new Error("INTERNAL_NETWORK_SIGNAL_SECRET must be configured in production.");
    }
    return LOCAL_SIGNAL_SECRET;
  }
  if (configured.length < 32) {
    throw new Error("INTERNAL_NETWORK_SIGNAL_SECRET must contain at least 32 characters.");
  }
  if (production && configured === LOCAL_SIGNAL_SECRET) {
    throw new Error("INTERNAL_NETWORK_SIGNAL_SECRET must be private in production.");
  }
  return configured;
}

function signalPayload({ network, timestamp, method, path }) {
  return ["recipe-lab-network-v1", network, String(timestamp), method.toUpperCase(), path].join(
    "\n",
  );
}

export function signNetworkSignal({ network, timestamp, method, path, secret }) {
  return createHmac("sha256", secret)
    .update(signalPayload({ network, timestamp, method, path }))
    .digest("hex");
}

function networkIsCanonical(network) {
  const separator = network.lastIndexOf("/");
  if (separator <= 0) {
    return false;
  }
  const address = network.slice(0, separator);
  const prefix = network.slice(separator + 1);
  return (
    ((prefix === "24" && isIP(address) === 4) || (prefix === "56" && isIP(address) === 6)) &&
    canonicalizeClientNetwork(address) === network
  );
}

export function buildNetworkSignalHeaders({
  remoteAddress,
  method,
  path,
  secret,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const network = canonicalizeClientNetwork(remoteAddress);
  if (!network) {
    return null;
  }
  const signature = signNetworkSignal({ network, timestamp, method, path, secret });
  return {
    [NETWORK_HEADER]: network,
    [NETWORK_TIMESTAMP_HEADER]: String(timestamp),
    [NETWORK_SIGNATURE_HEADER]: signature,
  };
}

export function verifyNetworkSignalHeaders(
  headers,
  {
    method,
    path,
    secret,
    now = Math.floor(Date.now() / 1000),
    ttlSeconds = DEFAULT_SIGNAL_TTL_SECONDS,
  },
) {
  const network = headers.get(NETWORK_HEADER);
  const rawTimestamp = headers.get(NETWORK_TIMESTAMP_HEADER);
  const signature = headers.get(NETWORK_SIGNATURE_HEADER);
  if (
    !network ||
    !networkIsCanonical(network) ||
    !rawTimestamp ||
    !/^\d{10}$/.test(rawTimestamp) ||
    !signature ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    return null;
  }
  const timestamp = Number.parseInt(rawTimestamp, 10);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > ttlSeconds) {
    return null;
  }
  const expected = signNetworkSignal({ network, timestamp, method, path, secret });
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(signature, "hex");
  if (
    expectedBytes.length !== receivedBytes.length ||
    !timingSafeEqual(expectedBytes, receivedBytes)
  ) {
    return null;
  }
  return {
    [NETWORK_HEADER]: network,
    [NETWORK_TIMESTAMP_HEADER]: rawTimestamp,
    [NETWORK_SIGNATURE_HEADER]: signature,
  };
}
