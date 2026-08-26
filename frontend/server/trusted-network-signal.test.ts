import { describe, expect, it } from "vitest";

import { hardenIncomingNetworkHeaders } from "../server.mjs";
import {
  buildNetworkSignalHeaders,
  canonicalizeClientNetwork,
  internalNetworkSignalSecret,
  NETWORK_HEADER,
  NETWORK_SIGNATURE_HEADER,
  NETWORK_TIMESTAMP_HEADER,
  signNetworkSignal,
  verifyNetworkSignalHeaders,
} from "./trusted-network-signal.mjs";

const SECRET = "frontend-network-signal-test-secret-123456";

describe("trusted frontend network boundary", () => {
  it("requires a private shared secret in production", () => {
    expect(() => internalNetworkSignalSecret({ NODE_ENV: "production" })).toThrow(
      "must be configured in production",
    );
    expect(() =>
      internalNetworkSignalSecret({ NODE_ENV: "production", INTERNAL_NETWORK_SIGNAL_SECRET: "x" }),
    ).toThrow("at least 32 characters");
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
    expect(headers[NETWORK_HEADER]).toBe("203.0.113.0/24");
    expect(headers[NETWORK_TIMESTAMP_HEADER]).toBe("1800000000");
    expect(headers[NETWORK_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
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
