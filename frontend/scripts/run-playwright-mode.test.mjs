// @vitest-environment node
import { describe, expect, it } from "vitest";

import { playwrightInvocation } from "./run-playwright-mode.mjs";

describe("explicit Playwright mode runner", () => {
  it("binds functional modes to the guarded default config", () => {
    expect(playwrightInvocation("acceptance", ["--list"])).toEqual({
      arguments: ["test", "--list"],
      environment: { PLAYWRIGHT_MODE: "acceptance" },
    });
  });

  it("binds visual mode to its deterministic config", () => {
    expect(playwrightInvocation("visual", ["--list"])).toEqual({
      arguments: [
        "test",
        "--config=playwright.baseline.config.ts",
        "--list",
      ],
      environment: {},
    });
  });

  it("refuses an omitted or unknown mode", () => {
    expect(() => playwrightInvocation(undefined)).toThrow(
      /Choose one explicit Playwright mode/,
    );
    expect(() => playwrightInvocation("everything")).toThrow(
      /Choose one explicit Playwright mode/,
    );
  });
});
