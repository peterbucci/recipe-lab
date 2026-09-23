import { describe, expect, it } from "vitest";

import { hardenIncomingNetworkHeaders } from "../server.mjs";
import {
  buildNetworkSignalHeaders,
  canonicalizeClientNetwork,
  internalNetworkSignalSecret,
  NETWORK_HEADER,
  NETWORK_SIGNATURE_HEADER,
  NETWORK_TIMESTAMP_HEADER,
  PROXY_PROOF_HEADER,
  signNetworkSignal,
  verifyNetworkSignalHeaders,
} from "./trusted-network-signal.mjs";

const SECRET = "frontend-network-signal-test-secret-123456";
const PROXY_PROOF = "a".repeat(64);

describe("trusted frontend network boundary", () => {
  it("requires a private shared secret in production", () => {
    expect(() => internalNetworkSignalSecret({ NODE_ENV: "production" })).toThrow(
      "must be configured in production",
    );
    expect(() =>
      internalNetworkSignalSecret({ NODE_ENV: "production", INTERNAL_NETWORK_SIGNAL_SECRET: "x" }),
    ).toThrow("at least 32 characters");
    expect(() =>
      internalNetworkSignalSecret({
        NODE_ENV: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET:
          "recipe-lab-local-internal-network-signal-secret",
      }),
    ).toThrow("must be private in production");
  });

  it("canonicalizes IPv4, mapped IPv4, and IPv6 networks", () => {
    expect(canonicalizeClientNetwork("192.0.2.129")).toBe("192.0.2.0/24");
    expect(canonicalizeClientNetwork("::ffff:192.0.2.129")).toBe("192.0.2.0/24");
    expect(canonicalizeClientNetwork("2001:db8:abcd:12ff::1")).toBe(
      "2001:db8:abcd:1200::/56",
    );
    expect(canonicalizeClientNetwork("not-an-ip")).toBeNull();
  });

  it("removes spoofable headers and replaces them with a socket-derived signal", () => {
    const headers = {
      forwarded: "for=198.51.100.9",
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "198.51.100.9",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
      [NETWORK_HEADER]: "198.51.100.0/24",
      [NETWORK_TIMESTAMP_HEADER]: "1000000000",
      [NETWORK_SIGNATURE_HEADER]: "0".repeat(64),
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "203.0.113.45",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
    });

    expect(headers).not.toHaveProperty("forwarded");
    expect(headers).not.toHaveProperty("x-forwarded-for");
    expect(headers).not.toHaveProperty("x-real-ip");
    expect(headers).not.toHaveProperty(PROXY_PROOF_HEADER);
    expect(headers[NETWORK_HEADER]).toBe("203.0.113.0/24");
    expect(headers[NETWORK_TIMESTAMP_HEADER]).toBe("1800000000");
    expect(headers[NETWORK_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the rightmost valid forwarded hop only from a proven trusted peer", () => {
    const headers = {
      forwarded: "for=192.0.2.22",
      "x-forwarded-for": "192.0.2.22, unknown, 198.51.100.77",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-real-ip": "192.0.2.22",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      forwardedFor: [headers["x-forwarded-for"]],
      method: "POST",
      path: "/api/recipe-drafts",
      proxyProof: [headers[PROXY_PROOF_HEADER]],
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("198.51.100.0/24");
    expect(headers).not.toHaveProperty("forwarded");
    expect(headers).not.toHaveProperty("x-forwarded-for");
    expect(headers).not.toHaveProperty("x-forwarded-host");
    expect(headers).not.toHaveProperty("x-forwarded-port");
    expect(headers).not.toHaveProperty("x-forwarded-proto");
    expect(headers).not.toHaveProperty("x-real-ip");
    expect(headers).not.toHaveProperty(PROXY_PROOF_HEADER);
  });

  it("rejects duplicate proxy-proof field lines", () => {
    const headers: Record<string, string> = {
      "x-forwarded-for": "198.51.100.77",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      forwardedFor: [headers["x-forwarded-for"]],
      method: "GET",
      path: "/api/recipes",
      proxyProof: [PROXY_PROOF, PROXY_PROOF],
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("172.18.0.0/24");
    expect(headers).not.toHaveProperty(PROXY_PROOF_HEADER);
  });

  it.each([
    ["missing proof", "172.18.0.9", undefined],
    ["incorrect proof", "172.18.0.9", "b".repeat(64)],
    ["untrusted peer", "172.20.0.9", PROXY_PROOF],
  ])(
    "ignores forwarded addresses for a %s",
    (_caseName, remoteAddress, proxyProof) => {
      const headers: Record<string, string> = {
        "x-forwarded-for": "198.51.100.77",
      };
      if (proxyProof) {
        headers[PROXY_PROOF_HEADER] = proxyProof;
      }

      hardenIncomingNetworkHeaders(headers, {
        remoteAddress,
        method: "GET",
        path: "/api/recipes",
        secret: SECRET,
        timestamp: 1_800_000_000,
        trustedProxyCidrs: ["172.18.0.0/16"],
        trustedProxyProofSecret: PROXY_PROOF,
      });

      expect(headers[NETWORK_HEADER]).toBe(
        remoteAddress === "172.20.0.9" ? "172.20.0.0/24" : "172.18.0.0/24",
      );
      expect(headers).not.toHaveProperty("x-forwarded-for");
      expect(headers).not.toHaveProperty(PROXY_PROOF_HEADER);
    },
  );

  it("matches IPv4-mapped socket peers against IPv4 trusted ranges", () => {
    const headers: Record<string, string> = {
      "x-forwarded-for": "203.0.113.90",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "::ffff:172.18.0.9",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("203.0.113.0/24");
  });

  it("does not scan leftward past a malformed final hop", () => {
    const headers: Record<string, string> = {
      "x-forwarded-for": "192.0.2.22, unknown",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("172.18.0.0/24");
  });

  it("falls back to the peer when the forwarded chain exceeds its bound", () => {
    const headers: Record<string, string> = {
      "x-forwarded-for": Array.from(
        { length: 33 },
        (_, index) => `198.51.100.${index + 1}`,
      ).join(","),
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("172.18.0.0/24");
  });

  it.each([
    ["duplicate", ["198.51.100.7", "203.0.113.8"]],
    ["invalid", "unknown, not-an-ip"],
  ])("falls back to the peer for a %s forwarded header", (_caseName, forwardedFor) => {
    const headers: Record<string, string | string[]> = {
      "x-forwarded-for": forwardedFor,
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("172.18.0.0/24");
    expect(headers).not.toHaveProperty("x-forwarded-for");
    expect(headers).not.toHaveProperty(PROXY_PROOF_HEADER);
  });

  it("supports a proven IPv6 proxy and forwarded client", () => {
    const headers: Record<string, string> = {
      "x-forwarded-for": "2001:db8:abcd:12ff::1",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "fd00:1234::9",
      method: "GET",
      path: "/api/recipes",
      secret: SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["fd00:1234::/64"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    expect(headers[NETWORK_HEADER]).toBe("2001:db8:abcd:1200::/56");
  });

  it("strips proxy metadata from non-API requests without creating a signal", () => {
    const headers: Record<string, string> = {
      forwarded: "for=198.51.100.7",
      "x-forwarded-for": "198.51.100.7",
      "x-forwarded-host": "recipes.example",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-real-ip": "198.51.100.7",
      [PROXY_PROOF_HEADER]: PROXY_PROOF,
    };

    hardenIncomingNetworkHeaders(headers, {
      remoteAddress: "172.18.0.9",
      method: "GET",
      path: "/recipes",
      secret: SECRET,
      trustedProxyCidrs: ["172.18.0.0/16"],
      trustedProxyProofSecret: PROXY_PROOF,
    });

    for (const name of [
      "forwarded",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
      "x-real-ip",
      PROXY_PROOF_HEADER,
    ]) {
      expect(headers).not.toHaveProperty(name);
    }
    expect(headers).not.toHaveProperty(NETWORK_HEADER);
  });

  it("binds fresh signals to their method and path and rejects tampering", () => {
    const timestamp = 1_800_000_000;
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "POST",
      path: "/api/recipe-drafts",
      secret: SECRET,
      timestamp,
    });
    expect(signal).not.toBeNull();
    const headers = new Headers(signal ?? {});

    expect(
      verifyNetworkSignalHeaders(headers, {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now: timestamp + 1,
      }),
    ).toEqual(signal);
    expect(
      verifyNetworkSignalHeaders(headers, {
        method: "DELETE",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now: timestamp + 1,
      }),
    ).toBeNull();
    headers.set(NETWORK_HEADER, "198.51.100.0/24");
    expect(
      verifyNetworkSignalHeaders(headers, {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now: timestamp + 1,
      }),
    ).toBeNull();
  });

  it("accepts the freshness boundary and rejects expired or future signals", () => {
    const timestamp = 1_800_000_000;
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "POST",
      path: "/api/recipe-drafts",
      secret: SECRET,
      timestamp,
    });
    const headers = new Headers(signal ?? {});
    const verifyAt = (now: number) =>
      verifyNetworkSignalHeaders(headers, {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now,
        ttlSeconds: 30,
      });

    expect(verifyAt(timestamp - 30)).toEqual(signal);
    expect(verifyAt(timestamp + 30)).toEqual(signal);
    expect(verifyAt(timestamp - 31)).toBeNull();
    expect(verifyAt(timestamp + 31)).toBeNull();
  });

  it.each([
    ["missing digits", "180000000"],
    ["extra digits", "18000000000"],
    ["decimal", "180000000.0"],
    ["negative", "-800000000"],
    ["non-numeric", "180000000x"],
  ])("rejects a malformed timestamp with %s", (_caseName, rawTimestamp) => {
    const timestamp = 1_800_000_000;
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "POST",
      path: "/api/recipe-drafts",
      secret: SECRET,
      timestamp,
    });
    const headers = new Headers(signal ?? {});
    headers.set(NETWORK_TIMESTAMP_HEADER, rawTimestamp);

    expect(
      verifyNetworkSignalHeaders(headers, {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now: timestamp,
      }),
    ).toBeNull();
  });

  it.each([
    ["too short", "0".repeat(63)],
    ["too long", "0".repeat(65)],
    ["non-hexadecimal", "g".repeat(64)],
    ["incorrect digest", "0".repeat(64)],
  ])("rejects a signature that is %s", (_caseName, signature) => {
    const timestamp = 1_800_000_000;
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "POST",
      path: "/api/recipe-drafts",
      secret: SECRET,
      timestamp,
    });
    const headers = new Headers(signal ?? {});
    headers.set(NETWORK_SIGNATURE_HEADER, signature);

    expect(
      verifyNetworkSignalHeaders(headers, {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: SECRET,
        now: timestamp,
      }),
    ).toBeNull();
  });

  it("rejects a correctly shaped signature made with a different secret", () => {
    const timestamp = 1_800_000_000;
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "POST",
      path: "/api/recipe-drafts",
      secret: SECRET,
      timestamp,
    });

    expect(
      verifyNetworkSignalHeaders(new Headers(signal ?? {}), {
        method: "POST",
        path: "/api/recipe-drafts",
        secret: [SECRET, "different"].join("-"),
        now: timestamp,
      }),
    ).toBeNull();
  });

  it("uses the versioned cross-service signature contract", () => {
    expect(
      signNetworkSignal({
        network: "203.0.113.0/24",
        timestamp: 1_800_000_000,
        method: "POST",
        path: "/api/recipes/example/view",
        secret: SECRET,
      }),
    ).toBe("cb8228793c37f809562c2266cd5cd8baae9170ab7a38219761bc7c5d57f86edd");
  });

  it("keeps distinct client networks distinct", () => {
    expect(canonicalizeClientNetwork("203.0.113.10")).not.toBe(
      canonicalizeClientNetwork("203.0.114.10"),
    );
  });
});
