import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findViolations,
  formatViolations,
  ordinaryUiFiles,
  repositoryPath,
  STAFF_DIAGNOSTIC_EXCEPTIONS,
} from "./content-language-policy-scanner";

describe("public product language policy", () => {
  it("inventories ordinary UI automatically and keeps exceptions narrow", () => {
    const files = ordinaryUiFiles();
    const inventory = new Set(files.map(repositoryPath));
    for (const exception of Object.keys(STAFF_DIAGNOSTIC_EXCEPTIONS)) {
      expect(
        inventory,
        `${exception} must remain an explicit, existing UI module`,
      ).toContain(exception);
    }

    const violations = files.flatMap((path) => {
      const file = repositoryPath(path);
      return findViolations(file, readFileSync(path, "utf8"));
    });
    expect(formatViolations(violations)).toBe("");
  });

  it("catches prohibited copy without confusing code identifiers for copy", () => {
    const ordinary = findViolations(
      "app/components/example.tsx",
      `
        const forkHref = "/recipes/example/fork";
        const fingerprint = "internal-retry-key";
        export function Example() {
          return <p>Get recommendations shaped by your activity from this immutable snapshot.</p>;
        }
      `,
    );
    expect(ordinary.map(({ rule }) => rule)).toEqual([
      "consumer-recommendation-language",
      "internal-recipe-language",
    ]);

    const staff = findViolations(
      "app/components/ingredient-request-decision-form.tsx",
      `export function Staff() {
        return <><p>Canonical identity</p><p>Get recommendations shaped by your activity.</p></>;
      }`,
    );
    expect(staff.map(({ rule }) => rule)).toEqual([
      "consumer-recommendation-language",
    ]);
  });

  it("checks UUID-shaped copy and statically initialized rendered aliases", () => {
    const visibleUuid = "99999999-9999-4999-8999-999999999999";
    const hiddenUuid = "88888888-8888-4888-8888-888888888888";
    const violations = findViolations(
      "app/components/example.tsx",
      `
        const forkHref = "/recipes/example/fork";
        const hiddenRecipeId = "${hiddenUuid}";
        export function Example() {
          const cta = "Fork this recipe";
          const visibleRecipeReference = "${visibleUuid}";
          return <>{forkHref ? <span>Ready</span> : null}<button>{cta}</button><p>{visibleRecipeReference}</p></>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "staff-identifiers",
    ]);
    expect(violations.map(({ text }) => text)).toEqual([
      "Fork this recipe",
      visibleUuid,
    ]);
    expect(formatViolations(violations)).not.toContain(hiddenUuid);
    expect(formatViolations(violations)).not.toContain("/recipes/example/fork");
  });

  it("checks custom copy props and static metadata objects", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        export const metadata = {
          title: "Immutable snapshot",
          description: "Get recommendations shaped by your activity",
        };
        export function Example() {
          return <Panel eyebrow="Canonical identity" primaryActionLabel="Case identifier" />;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "consumer-recommendation-language",
      "catalog-internals",
      "staff-identifiers",
    ]);
  });

  it("follows static copy returned by rendered helpers and metadata helpers", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        function relationshipGuidance(usePrimary: boolean) {
          if (usePrimary) return "Immutable snapshot";
          return secondaryGuidance();
        }
        function secondaryGuidance() {
          return "Canonical identity";
        }
        function buildMetadata() {
          return { description: "Recommendations picked for you" };
        }
        export function generateMetadata() {
          return buildMetadata();
        }
        export function Example() {
          return <p>{relationshipGuidance(true)}</p>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "consumer-recommendation-language",
      "future-personalization-claim",
      "catalog-internals",
    ]);
  });

  it("checks camel-case copy variables, plural copy maps, and setters", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        export function Example() {
          const emptyStateEyebrow = "Immutable snapshot";
          const statusLabels = { fallback: "Case identifier" };
          setPublicationStatusMessage("Canonical identity selected");
          return <p>{emptyStateEyebrow}{statusLabels.fallback}</p>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "staff-identifiers",
      "catalog-internals",
    ]);
  });

  it("leaves dynamic values to rendered tests but checks their static copy frame", () => {
    const dynamicOnly = findViolations(
      "app/components/example.tsx",
      `
        export function Example({ recipeId, policyVersion }) {
          return <Panel label={recipeId} eyebrow={policyVersion} />;
        }
      `,
    );
    expect(dynamicOnly).toEqual([]);

    const runtimeAlias = findViolations(
      "app/components/example.tsx",
      `
        export function Example() {
          const cta = loadRuntimeCopy();
          return <p>{cta}</p>;
        }
      `,
    );
    expect(runtimeAlias).toEqual([]);

    const staticFrame = findViolations(
      "app/components/example.tsx",
      `
        export function Example({ recipeId, policyVersion }) {
          return (
            <Panel
              label={\`Case identifier \${recipeId}\`}
              message={\`Policy version \${policyVersion}\`}
            />
          );
        }
      `,
    );
    expect(staticFrame.map(({ rule }) => rule)).toEqual([
      "staff-identifiers",
      "catalog-internals",
    ]);
  });
});

