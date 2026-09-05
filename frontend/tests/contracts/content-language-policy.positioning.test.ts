import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_ROOT,
  REPOSITORY_ROOT,
} from "./content-language-policy-scanner";

describe("public product language policy", () => {
  it("keeps public positioning limited to the shipped cook experience", () => {
    const read = (path: string) =>
      readFileSync(resolve(REPOSITORY_ROOT, path), "utf8").replace(
        /\r\n/g,
        "\n",
      );
    const readme = read("README.md");

    expect(readme).toMatch(
      /Find recipes,[\s\S]{0,120}make your own version,[\s\S]{0,120}follow recipe\s+history\./,
    );
    expect(readme).toMatch(
      /Research-preview engineering capabilities,[\s\S]{0,120}not consumer product\s+surfaces/,
    );
    expect(readme).toMatch(
      /\[product language and recommendation boundary\]\(docs\/product-language\.md\)/,
    );

    const publicReadme = readme.split("### Research preview:", 1)[0];
    const positioningSources = [
      "frontend/app/layout.tsx",
      "frontend/app/onboarding/page.tsx",
      "frontend/app/page.tsx",
      "frontend/app/sign-in/page.tsx",
    ].map((path) => read(path));
    positioningSources.unshift(publicReadme);
    const unsupportedClaims =
      /remember(?:s|ed)? what worked|learned substitutions?|personal intelligence|outcome[- ]based recommendations?|picked for you|tailored to your cooking|get recommendations shaped by your activity/i;

    for (const source of positioningSources)
      expect(source).not.toMatch(unsupportedClaims);
  });

  it("uses the preferred relationship and similarity labels", () => {
    const home = [
      readFileSync(resolve(APP_ROOT, "page.tsx"), "utf8"),
      readFileSync(
        resolve(APP_ROOT, "components/home-public-discovery.tsx"),
        "utf8",
      ),
    ].join("\n");
    const detail = [
      readFileSync(
        resolve(APP_ROOT, "components/recipe-detail-view.tsx"),
        "utf8",
      ),
      readFileSync(
        resolve(APP_ROOT, "components/recipe-family-navigator.tsx"),
        "utf8",
      ),
    ].join("\n");
    const similarity = readFileSync(
      resolve(APP_ROOT, "components/recipe-duplicate-preflight-review.tsx"),
      "utf8",
    );

    expect(home).toContain("Featured recipes");
    expect(detail).toContain("Based on");
    expect(detail).toContain("Recipe family");
    expect(similarity).toContain("Your version");
    expect(similarity).toContain("Similar recipes");
  });
});

