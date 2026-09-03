import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditCssArchitecture,
  CSS_LAYER_ORDER,
  expectedLayerForPath,
} from "./css-architecture.mjs";

describe("CSS architecture", () => {
  it("keeps every global stylesheet in its declared cascade layer", () => {
    expect(auditCssArchitecture(resolve(import.meta.dirname, ".."))).toEqual([]);
  });

  it("keeps the public layer order stable", () => {
    expect(CSS_LAYER_ORDER).toEqual([
      "tokens",
      "base",
      "shell",
      "primitives",
      "features",
      "patterns",
    ]);
  });

  it("derives ownership from the stylesheet location", () => {
    expect(expectedLayerForPath("app/styles/tokens.css")).toBe("tokens");
    expect(expectedLayerForPath("app/styles/shell/site-shell-auth.css")).toBe("shell");
    expect(expectedLayerForPath("app/styles/features/catalog.css")).toBe("features");
    expect(expectedLayerForPath("app/styles/patterns/workspace-tabs.css")).toBe("patterns");
    expect(expectedLayerForPath("app/styles/unowned.css")).toBeNull();
  });
});
