import { describe, expect, it } from "vitest";

import { runtimeConfiguration } from "./runtime-config.mjs";

const TEST_NETWORK_SIGNAL = "runtime-configuration-private-secret-123456";
const TEST_PROXY_PROOF = "a".repeat(64);

describe("frontend runtime configuration", () => {
  it("requires explicit production connectivity and a private shared secret", () => {
    expect(() => runtimeConfiguration({ APP_ENVIRONMENT: "production" })).toThrow(
      "INTERNAL_NETWORK_SIGNAL_SECRET must be configured in production",
    );
    expect(() =>
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
      }),
    ).toThrow("RECIPE_API_URL must be configured in production");
  });

  it("normalizes a valid production API origin", () => {
    expect(
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test/",
      }),
    ).toEqual({
      appEnvironment: "production",
      internalNetworkSignalSecret: TEST_NETWORK_SIGNAL,
      recipeApiUrl: "https://api.example.test",
      supervisorHeartbeat: null,
      trustedProxyCidrs: [],
      trustedProxyProofSecret: null,
    });
  });

  it("requires and normalizes the complete trusted-proxy boundary", () => {
    expect(
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test",
        TRUSTED_PROXY_CIDRS:
          " 172.18.0.7, 172.19.0.0/16, 2001:db8:0:1::/64 ",
        TRUSTED_PROXY_PROOF_SECRET: TEST_PROXY_PROOF,
      }),
    ).toEqual({
      appEnvironment: "production",
      internalNetworkSignalSecret: TEST_NETWORK_SIGNAL,
      recipeApiUrl: "https://api.example.test",
      supervisorHeartbeat: null,
      trustedProxyCidrs: [
        "172.18.0.7",
        "172.19.0.0/16",
        "2001:db8:0:1::/64",
      ],
      trustedProxyProofSecret: TEST_PROXY_PROOF,
    });
  });

  it.each([
    [{ TRUSTED_PROXY_CIDRS: "172.18.0.0/16" }, "configured together"],
    [{ TRUSTED_PROXY_PROOF_SECRET: TEST_PROXY_PROOF }, "configured together"],
    [
      {
        TRUSTED_PROXY_CIDRS: "172.18.0.0/16",
        TRUSTED_PROXY_PROOF_SECRET: "not-random-enough",
      },
      "64-character lowercase hexadecimal",
    ],
    [
      {
        TRUSTED_PROXY_CIDRS: "172.18.0.0/16",
        TRUSTED_PROXY_PROOF_SECRET: "A".repeat(64),
      },
      "64-character lowercase hexadecimal",
    ],
    [
      {
        TRUSTED_PROXY_CIDRS: "172.18.1.1/16",
        TRUSTED_PROXY_PROOF_SECRET: TEST_PROXY_PROOF,
      },
      "exact IP addresses or canonical narrow CIDRs",
    ],
    [
      {
        TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
        TRUSTED_PROXY_PROOF_SECRET: TEST_PROXY_PROOF,
      },
      "exact IP addresses or canonical narrow CIDRs",
    ],
  ])("fails closed for an unsafe trusted-proxy configuration", (proxy, message) => {
    expect(() =>
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test",
        ...proxy,
      }),
    ).toThrow(message);
  });

  it("does not echo an invalid proxy proof in startup errors", () => {
    const invalidProof = "private-but-not-hexadecimal-".padEnd(64, "z");
    let message = "";
    try {
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test",
        TRUSTED_PROXY_CIDRS: "172.18.0.0/16",
        TRUSTED_PROXY_PROOF_SECRET: invalidProof,
      });
    } catch (reason) {
      message = reason instanceof Error ? reason.message : String(reason);
    }
    expect(message).toContain("TRUSTED_PROXY_PROOF_SECRET");
    expect(message).not.toContain(invalidProof);
  });

  it("accepts the fixed supervisor heartbeat contract", () => {
    expect(
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test",
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH:
          "/run/recipe-lab-supervisor/heartbeat",
        SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "30",
      }),
    ).toEqual(
      expect.objectContaining({
        supervisorHeartbeat: {
          path: "/run/recipe-lab-supervisor/heartbeat",
          ttlSeconds: 30,
        },
      }),
    );
  });

  it.each([
    [
      {
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH:
          "/run/recipe-lab-supervisor/heartbeat",
      },
      "configured together",
    ],
    [
      { SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "30" },
      "configured together",
    ],
    [
      {
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH: "/tmp/attacker-controlled",
        SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "30",
      },
      "must be /run/recipe-lab-supervisor/heartbeat",
    ],
    [
      {
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH:
          "/run/recipe-lab-supervisor/heartbeat",
        SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "0",
      },
      "integer between 1 and 300",
    ],
    [
      {
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH:
          "/run/recipe-lab-supervisor/heartbeat",
        SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "301",
      },
      "integer between 1 and 300",
    ],
    [
      {
        SANDBOX_SUPERVISOR_HEARTBEAT_PATH:
          "/run/recipe-lab-supervisor/heartbeat",
        SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS: "30.5",
      },
      "integer between 1 and 300",
    ],
  ])("fails closed for invalid supervisor heartbeat configuration", (heartbeat, message) => {
    expect(() =>
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: "https://api.example.test",
        ...heartbeat,
      }),
    ).toThrow(message);
  });

  it.each([
    "not a URL",
    "file:///tmp/recipe-lab",
    "https://user:password@example.test",
    "https://api.example.test/private",
    "https://api.example.test?token=private",
    "https://api.example.test#private",
  ])("rejects an unsafe API origin without echoing it: %s", (configured) => {
    let message = "";
    try {
      runtimeConfiguration({
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
        RECIPE_API_URL: configured,
      });
    } catch (reason) {
      message = reason instanceof Error ? reason.message : String(reason);
    }
    expect(message).toContain("RECIPE_API_URL must be an HTTP(S) origin");
    expect(message).not.toContain(configured);
  });

  it("keeps local development defaults available without weakening production", () => {
    expect(runtimeConfiguration({}, { development: true })).toEqual({
      appEnvironment: "local",
      internalNetworkSignalSecret: "recipe-lab-local-internal-network-signal-secret",
      recipeApiUrl: "http://localhost:8000",
      supervisorHeartbeat: null,
      trustedProxyCidrs: [],
      trustedProxyProofSecret: null,
    });
  });

  it.each(["local", "test"])(
    "refuses %s mode when the production server is selected",
    (appEnvironment) => {
      expect(() =>
        runtimeConfiguration({
          APP_ENVIRONMENT: appEnvironment,
          INTERNAL_NETWORK_SIGNAL_SECRET: TEST_NETWORK_SIGNAL,
          RECIPE_API_URL: "http://api.internal:8000",
        }),
      ).toThrow("APP_ENVIRONMENT must be production for the production server");
    },
  );

  it("rejects unknown application environments without echoing other settings", () => {
    expect(() =>
      runtimeConfiguration({
        APP_ENVIRONMENT: "preview",
        INTERNAL_NETWORK_SIGNAL_SECRET: "do-not-echo-this-private-value",
      }),
    ).toThrow("APP_ENVIRONMENT must be local, test, or production");
  });
});
