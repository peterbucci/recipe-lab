import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const NETWORK_HEADER = "x-recipe-lab-client-network";
export const NETWORK_TIMESTAMP_HEADER = "x-recipe-lab-network-timestamp";
export const NETWORK_SIGNATURE_HEADER = "x-recipe-lab-network-signature";
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
  ...NETWORK_SIGNAL_HEADERS,
];

const LOCAL_SIGNAL_SECRET = "recipe-lab-local-internal-network-signal-secret";
const DEFAULT_SIGNAL_TTL_SECONDS = 30;

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

export function canonicalizeClientNetwork(remoteAddress) {
  if (typeof remoteAddress !== "string" || !remoteAddress.trim()) {
    return null;
  }
  const address = remoteAddress.trim();
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const ipv4 = parseIpv4(mappedIpv4 ?? address);
  if (ipv4) {
    return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
  }

  const words = ipv6Words(address);
  if (!words) {
    return null;
  }
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
