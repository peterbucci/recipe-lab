import { describe, expect, it } from "vitest";

import {
  auditFrontendArchitecture,
  forbiddenDependencyReason,
  migrationRuleForLegacyPath,
  ownerForPath,
} from "./frontend-architecture.mjs";

describe("frontend ownership architecture", () => {
  it("assigns runtime paths to their architectural owner", () => {
    expect(ownerForPath("app/recipes/page.tsx")).toEqual({ kind: "app" });
    expect(ownerForPath("features/recipes/detail/view.tsx")).toEqual({
      kind: "features",
      feature: "recipes",
    });
    expect(ownerForPath("shared/ui/overlay.tsx")).toEqual({ kind: "shared" });
    expect(ownerForPath("shell/site-header.tsx")).toEqual({ kind: "shell" });
    expect(ownerForPath("server/api-proxy.ts")).toEqual({ kind: "server" });
    expect(ownerForPath("app/components/recipe-card.tsx")).toEqual({ kind: "legacy" });
    expect(ownerForPath("lib/recipe-api.ts")).toEqual({ kind: "legacy" });
  });

  it("maps representative legacy source and test files to one migration story", () => {
    expect(migrationRuleForLegacyPath("app/components/site-header.tsx")?.story).toBe(
      "RCP-49B",
    );
    expect(
      migrationRuleForLegacyPath("app/components/recipe-card.test.tsx")?.story,
    ).toBe("RCP-49F");
    expect(migrationRuleForLegacyPath("lib/recipe-draft-api.test.ts")?.story).toBe(
      "RCP-49H",
    );
    expect(migrationRuleForLegacyPath("lib/new-unowned-client.ts")).toBeUndefined();
  });

  it("enforces inward dependency direction for the target roots", () => {
    expect(
      forbiddenDependencyReason("shared/ui/button.tsx", "features/auth/session.ts"),
    ).toBe("shared modules cannot depend on features modules");
    expect(
      forbiddenDependencyReason("features/auth/session.ts", "app/sign-in/page.tsx"),
    ).toBe("features modules cannot depend on app modules");
    expect(
      forbiddenDependencyReason("app/sign-in/page.tsx", "features/auth/sign-in.tsx"),
    ).toBeUndefined();
    expect(
      forbiddenDependencyReason("shell/site-header.tsx", "features/auth/session.ts"),
    ).toBeUndefined();
  });

  it("accounts for every current runtime, colocated test, and test-support module", () => {
    expect(auditFrontendArchitecture().errors).toEqual([]);
  });
});
