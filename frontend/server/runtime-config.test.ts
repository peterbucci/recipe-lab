import { describe, expect, it } from "vitest";

import { runtimeConfiguration } from "./runtime-config.mjs";

const TEST_NETWORK_SIGNAL = "runtime-configuration-private-secret-123456";

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
    });
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
