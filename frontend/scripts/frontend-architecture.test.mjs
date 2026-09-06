import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  auditFrontendArchitecture,
  clientServerBoundaryErrors,
  forbiddenDependencyReason,
  ownerForPath,
  reviewedCrossFeatureDependency,
  reviewedRecipeWorkflowDependency,
  runtimeDependencyCycleErrors,
} from "./frontend-architecture.mjs";

describe("frontend ownership architecture", () => {
  it("assigns runtime paths to their architectural owner", () => {
    expect(ownerForPath("app/recipes/page.tsx")).toEqual({ kind: "app" });
    expect(ownerForPath("features/recipes/detail/view.tsx")).toEqual({
      kind: "features",
      feature: "recipes",
    });
    expect(
      ownerForPath("features/ingredients/catalog/ingredient-catalog-api.ts"),
    ).toEqual({
      kind: "features",
      feature: "ingredients",
    });
    expect(ownerForPath("features/auth/auth-api.ts")).toEqual({
      kind: "features",
      feature: "auth",
    });
    expect(ownerForPath("features/account/member-activity.ts")).toEqual({
      kind: "features",
      feature: "account",
    });
    expect(ownerForPath("features/community/member-follow-api.ts")).toEqual({
      kind: "features",
      feature: "community",
    });
    expect(ownerForPath("shared/ui/overlay.tsx")).toEqual({ kind: "shared" });
    expect(ownerForPath("shell/site-header.tsx")).toEqual({ kind: "shell" });
    expect(ownerForPath("server/api-proxy.ts")).toEqual({ kind: "server" });
    expect(ownerForPath("server.mjs")).toEqual({ kind: "server" });
    expect(ownerForPath("app/components/recipe-card.tsx")).toEqual({ kind: "legacy" });
    expect(ownerForPath("lib/recipe-api.ts")).toEqual({ kind: "legacy" });
  });

  it("permits only reviewed cross-feature and recipe-workflow boundaries", () => {
    expect(
      reviewedCrossFeatureDependency(
        "features/community/public-cook-profile.ts",
        "features/recipes/shared/recipe-contracts.ts",
      ),
    ).toBe(true);
    expect(
      reviewedCrossFeatureDependency(
        "features/community/public-cook-profile.ts",
        "features/recipes/library/recipe-library-model.ts",
      ),
    ).toBe(false);
    expect(
      reviewedRecipeWorkflowDependency(
        "features/recipes/authoring/editor/recipe-category-selector.tsx",
        "features/recipes/browse/recipe-category-client-api.ts",
      ),
    ).toBe(true);
    expect(
      forbiddenDependencyReason(
        "features/recipes/shared/recipe-contracts.ts",
        "features/recipes/authoring/draft/recipe-draft.ts",
      ),
    ).toBe(
      "features/recipes/shared modules cannot depend on the unreviewed features/recipes/authoring boundary",
    );
    expect(
      forbiddenDependencyReason(
        "features/community/community-feed.ts",
        "features/recipes/library/recipe-library-model.ts",
      ),
    ).toBe(
      "features/community modules cannot depend on the unreviewed features/recipes boundary",
    );
    expect(
      forbiddenDependencyReason(
        "features/recipes/authoring/editor/recipe-draft-editor.tsx",
        "features/recipes/detail/recipe-detail-view.tsx",
      ),
    ).toBe(
      "features/recipes/authoring modules cannot depend on the unreviewed features/recipes/detail boundary",
    );
    expect(
      forbiddenDependencyReason(
        "features/recipes/detail/recipe-member-actions.tsx",
        "features/recipes/authoring/draft/recipe-draft-api.ts",
      ),
    ).toBeUndefined();
    expect(
      forbiddenDependencyReason(
        "features/recipes/shared/contracts.ts",
        "features/recipes/private-helper.ts",
      ),
    ).toBe(
      "features/recipes/shared modules cannot depend on the unreviewed features/recipes/(root) boundary",
    );
    expect(
      forbiddenDependencyReason(
        "features/recipes/private-helper.ts",
        "features/recipes/authoring/draft/model.ts",
      ),
    ).toBe(
      "features/recipes/(root) modules cannot depend on the unreviewed features/recipes/authoring boundary",
    );
  });

  it("enforces inward dependency direction for the target roots", () => {
    expect(forbiddenDependencyReason("shared/api/browser.ts", "lib/recipe-api.ts")).toBe(
      "shared modules cannot depend on retired legacy source locations",
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
    ).toBe("shell modules cannot depend on features modules");
    expect(
      forbiddenDependencyReason("shell/site-header.tsx", "shared/ui/button.tsx"),
    ).toBeUndefined();
  });

  it("accounts for every current runtime, colocated test, and test-support module", () => {
    const result = auditFrontendArchitecture();
    expect(result.errors).toEqual([]);
    expect(result.legacy).toEqual([]);
  });

  it("follows runtime edges but permits erased type-only server references", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "recipe-lab-architecture-"));
    const fixtureFiles = {
      "app/client.ts": '"use client"; import "../shared/api/mixed.js";',
      "shared/api/mixed.ts": 'import type { ServerType } from "./server.js"; export { type ServerType } from "./server.js";',
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

      writeFileSync(join(fixtureRoot, "shared/api/mixed.ts"), 'import "./server.js";');
      expect(auditFrontendArchitecture(fixtureRoot).errors).toEqual([
        "app/client.ts -> shared/api/mixed.ts -> shared/api/server.ts: client code reaches a server-only module",
      ]);

      writeFileSync(join(fixtureRoot, "shared/api/mixed.ts"), 'import "../../server.mjs";');
      expect(auditFrontendArchitecture(fixtureRoot).errors).toContain(
        "app/client.ts -> shared/api/mixed.ts -> server.mjs: client code reaches a server-only module",
      );

      writeFileSync(
        join(fixtureRoot, "app/client.ts"),
        '"use client"; import "../shared/api/jsx-entry.jsx";',
      );
      writeFileSync(
        join(fixtureRoot, "shared/api/jsx-entry.tsx"),
        'import "./module.mjs";',
      );
      writeFileSync(
        join(fixtureRoot, "shared/api/module.mts"),
        'import "./cjs-entry.cjs";',
      );
      writeFileSync(
        join(fixtureRoot, "shared/api/cjs-entry.cts"),
        'import "server-only";',
      );
      expect(auditFrontendArchitecture(fixtureRoot).errors).toContain(
        "app/client.ts -> shared/api/jsx-entry.tsx -> shared/api/module.mts -> shared/api/cjs-entry.cts: client code reaches a server-only module",
      );

      writeFileSync(
        join(fixtureRoot, "app/client.ts"),
        '"use client"; import "../shared/api/cycle-a.js";',
      );
      writeFileSync(
        join(fixtureRoot, "shared/api/cycle-a.ts"),
        'import "./cycle-b.js";',
      );
      writeFileSync(
        join(fixtureRoot, "shared/api/cycle-b.ts"),
        'import "./cycle-a.js";',
      );
      expect(auditFrontendArchitecture(fixtureRoot).errors).toContain(
        "shared/api/cycle-a.ts -> shared/api/cycle-b.ts -> shared/api/cycle-a.ts: circular runtime dependency",
      );

      const retiredLegacyPath = join(fixtureRoot, "lib/retired.ts");
      mkdirSync(dirname(retiredLegacyPath), { recursive: true });
      writeFileSync(retiredLegacyPath, "export const retired = true;");
      expect(auditFrontendArchitecture(fixtureRoot).errors).toContain(
        "lib/retired.ts: retired legacy source location is not allowed",
      );

      writeFileSync(join(fixtureRoot, "shared/index.mts"), "export const broad = true;");
      writeFileSync(join(fixtureRoot, "shared/api/index.cts"), "export const broad = true;");
      expect(auditFrontendArchitecture(fixtureRoot).errors).toEqual(
        expect.arrayContaining([
          "shared/api/index.cts: broad barrel files are not allowed",
          "shared/index.mts: broad barrel files are not allowed",
        ]),
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects an indirect client dependency on a server loader", () => {
    const graph = new Map([
      ["shared/api/browser.ts", ["shared/api/core.ts"]],
      ["features/recipes/authoring/editor.tsx", ["shared/catalog-model.ts"]],
      ["shared/catalog-model.ts", ["shared/api/server.ts"]],
    ]);
    expect(clientServerBoundaryErrors(graph,
      ["shared/api/browser.ts", "features/recipes/authoring/editor.tsx"],
      new Set(["shared/api/server.ts"]))).toEqual([
      "features/recipes/authoring/editor.tsx -> shared/catalog-model.ts -> shared/api/server.ts: client code reaches a server-only module",
    ]);
    expect(runtimeDependencyCycleErrors(new Map([
      ["features/recipes/browse/card.tsx", ["features/recipes/shared/contracts.ts"]],
      ["features/recipes/shared/contracts.ts", ["shared/format.ts"]],
      ["shared/format.ts", ["features/recipes/browse/card.tsx"]],
    ]))).toEqual([
      "features/recipes/browse/card.tsx -> features/recipes/shared/contracts.ts -> shared/format.ts -> features/recipes/browse/card.tsx: circular runtime dependency",
    ]);
    expect(runtimeDependencyCycleErrors(graph)).toEqual([]);
  });
});
