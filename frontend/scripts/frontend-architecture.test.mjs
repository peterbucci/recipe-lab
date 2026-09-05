import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  auditFrontendArchitecture,
  clientServerBoundaryErrors,
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
    expect(ownerForPath("server.mjs")).toEqual({ kind: "server" });
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
    expect(forbiddenDependencyReason("shared/api/browser.ts", "lib/auth-api.ts")).toBe(
      "shared modules cannot depend on legacy modules",
    );
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

  it("follows runtime edges but permits erased type-only server references", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "recipe-lab-architecture-"));
    const fixtureFiles = {
      "app/client.ts": '"use client"; import "../shared/api/mixed";',
      "shared/api/mixed.ts": 'import type { ServerType } from "./server"; export { type ServerType } from "./server";',
      "shared/api/server.ts": 'import "server-only"; export type ServerType = string;',
      "server.mjs": "export const runtime = true;",
    };

    try {
      for (const [file, source] of Object.entries(fixtureFiles)) {
        const target = join(fixtureRoot, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      vi.stubEnv("RECIPE_LAB_FRONTEND_DEPENDENCY_ROOT", process.cwd());
      expect(auditFrontendArchitecture(fixtureRoot).errors).toEqual([]);

      writeFileSync(join(fixtureRoot, "shared/api/mixed.ts"), 'import "./server";');
      expect(auditFrontendArchitecture(fixtureRoot).errors).toEqual([
        "app/client.ts -> shared/api/mixed.ts -> shared/api/server.ts: client code reaches a server-only module",
      ]);

      writeFileSync(join(fixtureRoot, "shared/api/mixed.ts"), 'import "../../server.mjs";');
      expect(auditFrontendArchitecture(fixtureRoot).errors).toContain(
        "app/client.ts -> shared/api/mixed.ts -> server.mjs: client code reaches a server-only module",
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects an indirect client dependency on a server loader", () => {
    const graph = new Map([
      ["shared/api/browser.ts", ["shared/api/core.ts"]],
      ["app/components/editor.tsx", ["lib/catalog-model.ts"]],
      ["lib/catalog-model.ts", ["shared/api/server.ts"]],
    ]);
    expect(clientServerBoundaryErrors(graph,
      ["shared/api/browser.ts", "app/components/editor.tsx"],
      new Set(["shared/api/server.ts"]))).toEqual([
      "app/components/editor.tsx -> lib/catalog-model.ts -> shared/api/server.ts: client code reaches a server-only module",
    ]);
  });
});
