import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

function ignoredIncomingRequests(): RegExp[] {
  const logging = nextConfig.logging;
  if (!logging || typeof logging === "boolean") {
    throw new Error("Development request logging is not configured.");
  }
  const incomingRequests = logging.incomingRequests;
  if (!incomingRequests || typeof incomingRequests === "boolean") {
    throw new Error("Sensitive incoming request exclusions are not configured.");
  }
  return incomingRequests.ignore ?? [];
}

describe("Next development logging", () => {
  it.each([
    "/api/auth/callback",
    "/api/auth/callback/",
    "/api/auth/callback?code=secret&state=secret",
    "http://127.0.0.1:3000/api/auth/callback?code=secret&state=secret",
  ])("does not log sensitive callback URL %s", (url) => {
    expect(ignoredIncomingRequests().some((pattern) => pattern.test(url))).toBe(true);
  });

  it("keeps ordinary development request logging available", () => {
    expect(
      ignoredIncomingRequests().some((pattern) => pattern.test("/api/recipes?q=carrot")),
    ).toBe(false);
  });
});
